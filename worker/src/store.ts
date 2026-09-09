export interface Decision {
  at: string;
  eventId: string;
  queryId: string | null;
  decision: string;
  detail?: Record<string, unknown>;
  latencyMs?: number;
  truncated?: boolean;
}

const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DECISION_TTL_SECONDS = 30 * 24 * 60 * 60;
const RAW_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Headroom under Cloudflare's 1024-byte KV metadata cap. */
const METADATA_BUDGET_BYTES = 900;

function metadataByteLength(record: Decision): number {
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

/** Shrinks string fields inside `detail` until the record fits the metadata budget. Never drops the record. */
function fitToBudget(record: Decision): Decision {
  if (metadataByteLength(record) <= METADATA_BUDGET_BYTES) return record;

  let maxLen = 200;
  let candidate = record;
  while (metadataByteLength(candidate) > METADATA_BUDGET_BYTES && maxLen >= 1) {
    const detail: Record<string, unknown> = {};
    if (record.detail) {
      for (const [k, v] of Object.entries(record.detail)) {
        detail[k] = typeof v === "string" && v.length > maxLen ? v.slice(0, maxLen) : v;
      }
    }
    candidate = { ...record, detail, truncated: true };
    maxLen = Math.floor(maxLen / 2);
  }
  return candidate;
}

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
  const parsedMs = Date.parse(d.at);
  const atMs = Number.isFinite(parsedMs) ? parsedMs : Date.now();
  const record = fitToBudget(d);
  await kv.put(decisionKey(d.eventId, atMs), "", {
    metadata: record,
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
