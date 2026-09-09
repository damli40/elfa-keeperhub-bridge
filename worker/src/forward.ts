import type { Env } from "./index";

export interface ForwardPayload {
  source: "elfa-auto";
  eventId: string;
  queryId: string;
  title: string;
  body: string;
  observedValue: string | null;
  triggerTime: string | null;
}

export interface PostResult {
  status: number | null;
  body: string;
  executionId?: string;
}

export const RETRY_DELAYS_MS = [2000, 10000, 30000];

const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 410]);

export function sanitize(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.replaceAll("{{", "").replaceAll("}}", "").slice(0, max);
}

export function extractContext(body: unknown): { observedValue: string | null; triggerTime: string | null } {
  const trigger = (body as { trigger?: unknown })?.trigger as
    | { time?: unknown; matchedConditions?: Array<{ match?: { observedValue?: unknown } }> }
    | undefined;

  const observed = trigger?.matchedConditions?.[0]?.match?.observedValue;
  return {
    observedValue: observed === undefined || observed === null ? null : String(observed),
    triggerTime: typeof trigger?.time === "string" ? trigger.time : null,
  };
}

export function buildPayload(eventId: string, queryId: string, body: unknown): ForwardPayload {
  const { observedValue, triggerTime } = extractContext(body);
  const source = body as { title?: unknown; body?: unknown };
  return {
    source: "elfa-auto",
    eventId,
    queryId,
    title: sanitize(source?.title),
    body: sanitize(source?.body),
    observedValue,
    triggerTime,
  };
}

export function classify(status: number | null): "ok" | "permanent" | "transient" {
  if (status === null) return "transient";
  if (status >= 200 && status < 300) return "ok";
  if (PERMANENT_STATUSES.has(status)) return "permanent";
  return "transient";
}

export async function postOnce(env: Env, workflowId: string, payload: ForwardPayload): Promise<PostResult> {
  try {
    const res = await fetch(`${env.KEEPERHUB_BASE}/api/workflows/${workflowId}/webhook`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.KEEPERHUB_WEBHOOK_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `elfa-${payload.eventId}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let executionId: string | undefined;
    try {
      executionId = (JSON.parse(text) as { executionId?: string }).executionId;
    } catch {
      // KeeperHub returned something that is not JSON; the raw text is kept in body.
    }
    return { status: res.status, body: text.slice(0, 500), executionId };
  } catch (error) {
    return { status: null, body: String(error).slice(0, 500) };
  }
}
