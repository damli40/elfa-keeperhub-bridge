export interface Decision {
  at: string;
  eventId: string;
  queryId: string | null;
  decision: string;
  detail?: Record<string, unknown>;
  latencyMs?: number;
}

const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DECISION_TTL_SECONDS = 30 * 24 * 60 * 60;
const RAW_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Wider than any millisecond timestamp this century, so the difference never goes negative. */
const REVERSE_BASE = 9_999_999_999_999;

export function decisionKey(eventId: string, atMs: number): string {
  const reverse = String(REVERSE_BASE - atMs).padStart(13, "0");
  return `decision:${reverse}:${eventId}`;
}

export async function seenBefore(kv: KVNamespace, eventId: string): Promise<boolean> {
  return (await kv.get(`seen:${eventId}`)) !== null;
}

export async function markSeen(kv: KVNamespace, eventId: string): Promise<void> {
  await kv.put(`seen:${eventId}`, "1", { expirationTtl: SEEN_TTL_SECONDS });
}

export async function recordDecision(kv: KVNamespace, d: Decision): Promise<void> {
  await kv.put(decisionKey(d.eventId, Date.parse(d.at)), "", {
    metadata: d,
    expirationTtl: DECISION_TTL_SECONDS,
  });
}

export async function recentDecisions(kv: KVNamespace, limit = 200): Promise<Decision[]> {
  const listed = await kv.list<Decision>({ prefix: "decision:", limit });
  return listed.keys.map((k) => k.metadata).filter((m): m is Decision => Boolean(m));
}

export async function storeRaw(kv: KVNamespace, eventId: string, body: string): Promise<void> {
  await kv.put(`raw:${eventId}`, body, { expirationTtl: RAW_TTL_SECONDS });
}
