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

export const VERSION = "1.0.0";

/**
 * Requests rejected before any storage, counted in memory only so junk traffic (unsigned, or
 * carrying an eventId that fails the allowlist) costs no KV writes and cannot exhaust the
 * free-tier write budget.
 */
let rejectedUnsigned = 0;

export function parseRoutes(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
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

async function forwardWithRetry(env: Env, ctx: ExecutionContext, workflowId: string, payload: ForwardPayload, base: Decision): Promise<Decision> {
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
        await new Promise((resolve) => setTimeout(resolve, delay));
        const retry = await postOnce(env, workflowId, payload);
        last = retry;
        if (classify(retry.status) === "ok") {
          await recordDecision(env.BRIDGE, {
            ...base,
            at: new Date().toISOString(),
            decision: "forwarded:ok_after_retry",
            detail: { workflowId, executionId: retry.executionId ?? null },
          });
          return;
        }
        if (classify(retry.status) === "permanent") {
          await recordDecision(env.BRIDGE, {
            ...base,
            at: new Date().toISOString(),
            decision: "forwarded:permanent_error",
            detail: { workflowId, status: retry.status, body: retry.body },
          });
          return;
        }
      }
      await recordDecision(env.BRIDGE, {
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
    await recordDecision(env.BRIDGE, { ...decision, latencyMs: Date.now() - startedAt });
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
  const queryId = (parsed as { data?: { queryId?: string } })?.data?.queryId ?? null;
  const workflowId = queryId ? parseRoutes(env.ROUTES)[queryId] : undefined;
  if (!queryId || !workflowId) {
    return finish({ ...base, queryId, decision: "dropped:unrouted" }, 200);
  }

  if (await seenBefore(env.BRIDGE, headers.eventId)) {
    return finish({ ...base, queryId, decision: "dropped:duplicate" }, 200);
  }
  await markSeen(env.BRIDGE, headers.eventId);
  await storeRaw(env.BRIDGE, headers.eventId, rawBody);

  const payload = buildPayload(headers.eventId, queryId, parsed);
  const outcome = await forwardWithRetry(env, ctx, workflowId, payload, { ...base, queryId });
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
      return Response.json({
        ok: true,
        enabled: env.BRIDGE_ENABLED === "true",
        routes: Object.keys(parseRoutes(env.ROUTES)).length,
        version: VERSION,
        rejectedUnsigned,
      });
    }

    return new Response("not found", { status: 404 });
  },
};
