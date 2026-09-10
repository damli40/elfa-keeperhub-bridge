import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildFundingQuery,
  buildPriceQuery,
  elfaCreate,
  elfaValidate,
  type ElfaQuery,
} from "./elfa";

const WRANGLER_CONFIG = "wrangler.toml";

export async function assertWorkerReachable(workerUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${workerUrl}/health`);
  } catch (error) {
    throw new Error(
      `Could not reach ${workerUrl}/health (${String(error)}). Deploy the Worker first because Elfa resolves the webhook host when it creates a plan.`,
    );
  }

  if (!response.ok) {
    throw new Error(`${workerUrl}/health returned ${response.status}`);
  }

  const health = (await response.json()) as { ok?: boolean };
  if (health.ok !== true) {
    throw new Error(`${workerUrl}/health did not report ok=true`);
  }
}

export function mergeRoutes(
  existing: Record<string, string>,
  queryId: string,
  workflowId: string,
): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(existing),
    [queryId, workflowId],
  ]);
}

export function parseRoutesFromToml(toml: string): Record<string, string> {
  const match = toml.match(/^\s*ROUTES\s*=\s*("(?:\\.|[^"\\])*")\s*$/m);
  if (!match) return {};

  try {
    const json = JSON.parse(match[1]) as string;
    const routes = JSON.parse(json) as unknown;
    if (routes === null || Array.isArray(routes) || typeof routes !== "object") {
      return {};
    }

    const clean: Record<string, string> = {};
    for (const [queryId, workflowId] of Object.entries(routes)) {
      if (typeof workflowId === "string") clean[queryId] = workflowId;
    }
    return clean;
  } catch {
    return {};
  }
}

export function updateWranglerVars(
  toml: string,
  routes: Record<string, string>,
  enabled = true,
): string {
  if (
    !/^\s*ROUTES\s*=.*$/m.test(toml) ||
    !/^\s*BRIDGE_ENABLED\s*=.*$/m.test(toml)
  ) {
    throw new Error("wrangler.toml is missing ROUTES or BRIDGE_ENABLED variables");
  }

  const routeLiteral = JSON.stringify(JSON.stringify(routes));
  const next = toml
    .replace(/^\s*ROUTES\s*=.*$/m, `ROUTES = ${routeLiteral}`)
    .replace(
      /^\s*BRIDGE_ENABLED\s*=.*$/m,
      `BRIDGE_ENABLED = "${String(enabled)}"`,
    );

  return next;
}

export function extractCreatedQueryId(response: unknown): string {
  const value = response as {
    id?: unknown;
    data?: { id?: unknown };
    query?: { id?: unknown };
  } | null;
  const id = value?.id ?? value?.data?.id ?? value?.query?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Elfa create response did not include a query id");
  }
  return id;
}

export function readConfiguredRoutes(
  configPath = WRANGLER_CONFIG,
): Record<string, string> {
  return parseRoutesFromToml(readFileSync(configPath, "utf8"));
}

export function publishRoutes(
  routes: Record<string, string>,
  enabled = true,
): void {
  const current = readFileSync(WRANGLER_CONFIG, "utf8");
  writeFileSync(
    WRANGLER_CONFIG,
    updateWranglerVars(current, routes, enabled),
  );
  execFileSync("npx", ["wrangler", "deploy"], { stdio: "inherit" });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function runSetup(options: {
  film: boolean;
  threshold?: number;
}): Promise<{ queryId: string; workflowId: string }> {
  const workerUrl = requireEnv("WORKER_URL").replace(/\/$/, "");
  const signingSecret = requireEnv("ELFA_SIGNING_SECRET");
  const workflowId = requireEnv("KEEPERHUB_WORKFLOW_ID");

  await assertWorkerReachable(workerUrl);

  const query: ElfaQuery = options.film
    ? buildPriceQuery(
        `${workerUrl}/elfa`,
        signingSecret,
        "BTC",
        options.threshold ?? 0,
      )
    : buildFundingQuery(`${workerUrl}/elfa`, signingSecret);

  const validation = (await elfaValidate(query)) as {
    valid?: boolean;
    errors?: unknown[];
  };
  if (validation.valid !== true) {
    throw new Error(
      `Elfa rejected the plan: ${JSON.stringify(validation.errors ?? validation)}`,
    );
  }

  const queryId = extractCreatedQueryId(await elfaCreate(query));
  publishRoutes(
    mergeRoutes(readConfiguredRoutes(), queryId, workflowId),
  );

  console.log(`Elfa plan created: ${queryId}`);
  console.log(`Routed ${queryId} to workflow ${workflowId}; bridge enabled.`);
  return { queryId, workflowId };
}
