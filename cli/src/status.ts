import { elfaGet } from "./elfa";
import { khLastExecution } from "./keeperhub";
import { readConfiguredRoutes } from "./setup";

export function summarizeExecution(execution: unknown): Record<string, unknown> | null {
  if (execution === null || typeof execution !== "object") return null;

  const value = execution as {
    id?: unknown;
    status?: unknown;
    completedAt?: unknown;
    transactionHashes?: unknown[];
  };
  const transactions = Array.isArray(value.transactionHashes)
    ? value.transactionHashes.flatMap((item) => {
        const tx = item as {
          hash?: unknown;
          chainId?: unknown;
          verified?: unknown;
        };
        if (typeof tx.hash !== "string") return [];
        return [{
          hash: tx.hash,
          ...(typeof tx.chainId === "number" ? { chainId: tx.chainId } : {}),
          ...(typeof tx.verified === "boolean" ? { verified: tx.verified } : {}),
        }];
      })
    : [];

  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : {}),
    transactions,
  };
}

export async function runStatus(): Promise<void> {
  const workerUrl = process.env.WORKER_URL?.replace(/\/$/, "");
  const workflowId = process.env.KEEPERHUB_WORKFLOW_ID;
  if (!workerUrl || !workflowId) {
    throw new Error("WORKER_URL and KEEPERHUB_WORKFLOW_ID must be set");
  }

  const healthResponse = await fetch(`${workerUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`Worker health returned ${healthResponse.status}`);
  }
  console.log("Worker:", await healthResponse.json());

  const routes = readConfiguredRoutes();
  for (const queryId of Object.keys(routes)) {
    const plan = (await elfaGet(queryId)) as {
      status?: string;
      latestEvaluation?: {
        evaluatedAt?: string;
        matchingConditions?: number;
        totalConditions?: number;
      };
    };
    const evaluatedAt = plan.latestEvaluation?.evaluatedAt;
    const ageMinutes = evaluatedAt
      ? Math.round((Date.now() - Date.parse(evaluatedAt)) / 60_000)
      : null;
    console.log(
      `Plan ${queryId}: status=${plan.status ?? "unknown"}, conditions=${plan.latestEvaluation?.matchingConditions ?? "?"}/${plan.latestEvaluation?.totalConditions ?? "?"}, evaluated=${ageMinutes === null ? "never" : `${ageMinutes} min ago`}`,
    );
    if (ageMinutes !== null && ageMinutes > 60) {
      console.log("  WARNING: this plan has not been evaluated in over an hour.");
    }
  }

  const auditResponse = await fetch(`${workerUrl}/audit`);
  if (!auditResponse.ok) {
    console.log(
      `Worker audit unavailable (${auditResponse.status}); deploy the current Worker before end-to-end testing.`,
    );
  } else {
    const decisions = (await auditResponse.json()) as Array<{
      at: string;
      eventId: string;
      decision: string;
    }>;
    console.log("Last bridge decisions:");
    for (const decision of decisions.slice(0, 10)) {
      console.log(`  ${decision.at} ${decision.eventId} ${decision.decision}`);
    }
  }

  console.log(
    "Last KeeperHub execution:",
    summarizeExecution(await khLastExecution(workflowId)),
  );
}
