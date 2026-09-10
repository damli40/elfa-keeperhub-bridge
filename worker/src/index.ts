import { readHeaders, verifySignature, isFresh } from "./verify";
import { markSeen, recentDecisions, recordDecision, seenBefore, storeRaw, type Decision } from "./store";
import { buildPayload, classify, isValidEventId, postOnce, RETRY_DELAYS_MS, type ForwardPayload } from "./forward";

export interface Env {
  BRIDGE: KVNamespace;
  ELFA_SIGNING_SECRET: string;
  KEEPERHUB_WEBHOOK_KEY: string;
  KEEPERHUB_BASE: string;
  BRIDGE_ENABLED: string;
  ROUTES: string;
}

export const VERSION = "1.0.1";

/**
 * Requests rejected before any storage, counted in memory only so junk traffic (unsigned, or
 * carrying an eventId that fails the allowlist) costs no KV writes and cannot exhaust the
 * free-tier write budget.
 */
let rejectedUnsigned = 0;

/**
 * Requests whose decision-record persistence itself failed (KV cap exceeded, quota exhausted,
 * transient error). Counted rather than allowed to 500 the response: the spec requires the
 * Worker to always return 200 after signature verification so Elfa never retry-storms, and a
 * failed `recordDecision` must not become the exception to that rule.
 */
let failedPersists = 0;

export interface ParsedRoutes {
  routes: Record<string, string>;
  /** Own entries in ROUTES whose value was not a string, so a config typo is visible on
   * /health instead of reading forever as silent "unrouted" traffic with no diagnosis. */
  malformed: number;
}

/**
 * Parses ROUTES into a lookup with no prototype chain (`Object.create(null)`) and copies only
 * own, string-valued entries. Two independent guards against the same bug: a queryId of
 * `"constructor"`, `"__proto__"`, `"toString"` or `"valueOf"` must never resolve to an inherited
 * Object.prototype function and be treated as a truthy workflow id — that would pass the
 * unrouted gate, burn a `seen:`/`raw:` KV write, and forward to a garbage URL.
 */
export function parseRoutesDetailed(raw: string): ParsedRoutes {
  const routes: Record<string, string> = Object.create(null);
  let malformed = 0;
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { routes, malformed };
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") routes[key] = value;
      else malformed++;
    }
    return { routes, malformed };
  } catch {
    return { routes, malformed };
  }
}

export function parseRoutes(raw: string): Record<string, string> {
  return parseRoutesDetailed(raw).routes;
}

/** Own-property, type-checked route lookup — belt and braces alongside parseRoutes's null-prototype map. */
function resolveWorkflowId(routes: Record<string, string>, queryId: string): string | undefined {
  if (!Object.hasOwn(routes, queryId)) return undefined;
  const value = routes[queryId];
  return typeof value === "string" ? value : undefined;
}

/** Caps a Decision's top-level queryId to the same 200-char budget as title/body/observedValue in
 * forward.ts's sanitize(). fitToBudget in store.ts only shrinks strings inside `detail`, so an
 * unbounded top-level queryId can push metadata past Cloudflare's 1024-byte cap and make
 * `kv.put` throw — losing the audit record for exactly the request that most needs one. */
function boundedQueryId(queryId: string | null, max = 200): string | null {
  return queryId === null ? null : queryId.slice(0, max);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderAudit(decisions: Decision[]): string {
  const rows = decisions
    .map(
      (d) =>
        `<tr><td>${escapeHtml(d.at)}</td><td>${escapeHtml(d.eventId)}</td><td>${escapeHtml(d.queryId)}</td>` +
        `<td>${escapeHtml(d.decision)}</td><td><code>${escapeHtml(JSON.stringify(d.detail ?? {}))}</code></td></tr>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Elfa → KeeperHub bridge audit</title>
<style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #ddd;padding:.4rem .6rem;text-align:left;vertical-align:top}
code{font-size:12px;word-break:break-all}</style>
<h1>Bridge decisions</h1><p>Newest first. Every delivery Elfa sent, and what the bridge did with it.</p>
<table><thead><tr><th>at</th><th>event</th><th>query</th><th>decision</th><th>detail</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Real production delay. Tests inject a fake so the 2s/10s/30s schedule doesn't have to
 * actually elapse in CI; the production schedule itself (RETRY_DELAYS_MS) is untouched. */
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Persists a Decision, swallowing (and counting) any KV failure so a failed audit write can
 * never turn the spec's "always 200 after signature verification" into a 500. */
async function safeRecordDecision(kv: KVNamespace, decision: Decision): Promise<void> {
  try {
    await recordDecision(kv, decision);
  } catch {
    failedPersists++;
  }
}

/**
 * Ruling 10: `markSeen` and `storeRaw` must fail open, the same way `recordDecision` does — a KV
 * outage on either of these three calls must never turn a 200 into a 500, which is exactly the
 * retry-storm the whole design exists to prevent. Failing open on the dedupe mark specifically is
 * correct because KeeperHub's own `Idempotency-Key` (built from this same eventId) is the real
 * duplicate guarantee; the KV `seen:` mark is a fast-path optimisation on top of it, not the only
 * guard. A lost mark just means this one event skips the fast path and is caught downstream.
 */
async function safeMarkSeen(kv: KVNamespace, eventId: string): Promise<void> {
  try {
    await markSeen(kv, eventId);
  } catch {
    failedPersists++;
  }
}

async function safeStoreRaw(kv: KVNamespace, eventId: string, body: string): Promise<void> {
  try {
    await storeRaw(kv, eventId, body);
  } catch {
    failedPersists++;
  }
}

export async function forwardWithRetry(
  env: Env,
  ctx: ExecutionContext,
  workflowId: string,
  payload: ForwardPayload,
  base: Decision,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<Decision> {
  const first = await postOnce(env, workflowId, payload);
  const verdict = classify(first.status);

  if (verdict === "ok") {
    return { ...base, decision: "forwarded:ok", detail: { workflowId, executionId: first.executionId ?? null } };
  }
  if (verdict === "permanent") {
    return { ...base, decision: "forwarded:permanent_error", detail: { workflowId, status: first.status, body: first.body } };
  }

  // Transient: keep trying in the background. Elfa already has its 200, and the
  // idempotency key means a late success cannot execute twice.
  ctx.waitUntil(
    (async () => {
      let last = first;
      for (const defaultDelay of RETRY_DELAYS_MS) {
        const delay = last.retryAfterMs ?? defaultDelay;
        await sleep(delay);
        const retry = await postOnce(env, workflowId, payload);
        last = retry;
        if (classify(retry.status) === "ok") {
          await safeRecordDecision(env.BRIDGE, {
            ...base,
            at: new Date().toISOString(),
            decision: "forwarded:ok_after_retry",
            detail: { workflowId, executionId: retry.executionId ?? null },
          });
          return;
        }
        if (classify(retry.status) === "permanent") {
          await safeRecordDecision(env.BRIDGE, {
            ...base,
            at: new Date().toISOString(),
            decision: "forwarded:permanent_error",
            detail: { workflowId, status: retry.status, body: retry.body },
          });
          return;
        }
      }
      await safeRecordDecision(env.BRIDGE, {
        ...base,
        at: new Date().toISOString(),
        decision: "forwarded:gave_up",
        detail: { workflowId },
      });
    })(),
  );

  return { ...base, decision: "forwarded:retrying", detail: { workflowId, status: first.status, body: first.body } };
}

async function handleElfa(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const startedAt = Date.now();

  const headers = readHeaders(request.headers);
  if (!headers) {
    rejectedUnsigned++;
    return new Response("missing signature headers", { status: 400 });
  }

  const rawBody = await request.text();

  // Signature first: everything below this line costs KV writes. Spec invariant 7 — a
  // failed-signature request performs zero KV writes — depends on this ordering.
  if (!(await verifySignature(env.ELFA_SIGNING_SECRET, { ...headers, rawBody }))) {
    rejectedUnsigned++;
    return new Response("bad signature", { status: 401 });
  }

  // Ruling 9: validate (never sanitize) the eventId before it touches KV in any way. A
  // malformed id must not become a `seen:`/`decision:`/`raw:` key or an Idempotency-Key header.
  if (!isValidEventId(headers.eventId)) {
    rejectedUnsigned++;
    return new Response("invalid eventId", { status: 400 });
  }

  const base: Decision = { at: new Date().toISOString(), eventId: headers.eventId, queryId: null, decision: "" };
  const finish = async (decision: Decision, status: number): Promise<Response> => {
    await safeRecordDecision(env.BRIDGE, {
      ...decision,
      queryId: boundedQueryId(decision.queryId),
      latencyMs: Date.now() - startedAt,
    });
    return new Response(decision.decision, { status });
  };

  if (!isFresh(headers.timestamp, Math.floor(Date.now() / 1000))) {
    return finish({ ...base, decision: "refused:stale" }, 401);
  }

  if (env.BRIDGE_ENABLED !== "true") {
    return finish({ ...base, decision: "dropped:kill_switch" }, 200);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return finish({ ...base, decision: "refused:bad_json" }, 200);
  }

  // Ruling 1: route on the RAW queryId, never the sanitised copy — sanitising is many-to-one,
  // so a legitimate id containing a stripped sequence would otherwise silently fail to route.
  const event = parsed as {
    status?: unknown;
    queryId?: unknown;
    data?: { queryId?: unknown };
  };
  const rawQueryId = event?.data?.queryId ?? event?.queryId;
  const queryId = typeof rawQueryId === "string" ? rawQueryId : null;
  const lifecycleStatus = typeof event?.status === "string" ? event.status : null;
  const workflowId = queryId ? resolveWorkflowId(parseRoutes(env.ROUTES), queryId) : undefined;

  // Bound once here so every Decision derived from this point on — whether written through
  // `finish` or, in the retry loop, written directly by safeRecordDecision without ever passing
  // through `finish` — inherits the same bounded value. Routing above and buildPayload below
  // both still use the raw, uncapped `queryId`.
  const decisionBase: Decision = { ...base, queryId: boundedQueryId(queryId) };

  // `allNotifications: true` opts webhooks into lifecycle events such as `expired` and
  // `run-failed`. A lifecycle notification is never an execution instruction. Keep this gate
  // even though the query builders explicitly set allNotifications=false: it protects the
  // wallet if an operator creates or edits a query outside this CLI.
  if (lifecycleStatus !== null && lifecycleStatus !== "triggered") {
    return finish({ ...decisionBase, decision: "dropped:lifecycle" }, 200);
  }

  if (!queryId || !workflowId) {
    return finish({ ...decisionBase, decision: "dropped:unrouted" }, 200);
  }

  if (await seenBefore(env.BRIDGE, headers.eventId)) {
    return finish({ ...decisionBase, decision: "dropped:duplicate" }, 200);
  }
  await safeMarkSeen(env.BRIDGE, headers.eventId);
  await safeStoreRaw(env.BRIDGE, headers.eventId, rawBody);

  const payload = buildPayload(headers.eventId, queryId, parsed);
  const outcome = await forwardWithRetry(env, ctx, workflowId, payload, decisionBase);
  return finish(outcome, 200);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/elfa" && request.method === "POST") {
      return handleElfa(request, env, ctx);
    }

    if (url.pathname === "/audit" && request.method === "GET") {
      const decisions = await recentDecisions(env.BRIDGE, 200);
      if (url.searchParams.get("format") === "html") {
        return new Response(renderAudit(decisions), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return Response.json(decisions);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      const { routes, malformed } = parseRoutesDetailed(env.ROUTES);
      return Response.json({
        ok: true,
        enabled: env.BRIDGE_ENABLED === "true",
        routes: Object.keys(routes).length,
        version: VERSION,
        rejectedUnsigned,
        failedPersists,
        malformedRoutes: malformed,
      });
    }

    return new Response("not found", { status: 404 });
  },
};
