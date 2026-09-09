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
  retryAfterMs: number | null;
}

export const RETRY_DELAYS_MS = [2000, 10000, 30000];

const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 410]);

// Upper bound on any Retry-After delay we will trust. Anything beyond this is
// treated as malformed/absurd and falls back to null rather than stalling a retry loop.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

// A rejected header build (invalid eventId) is reported through this synthetic status so
// classify() treats it the same as any other client error we cannot fix by retrying: permanent.
const INVALID_EVENT_ID_STATUS = 400;

/**
 * Strips `{{` and `}}` so nothing arriving from outside can become a KeeperHub template.
 * A single pass is defeatable by interleaving (e.g. "{}}{" -> stripping "}}" alone re-forms
 * "{{"), so this repeats the two replacements until the string stops changing (a fixed point).
 * Truncation happens FIRST, before the loop, so the loop's cost is bounded by the output size
 * (`max`, 200 chars) rather than an attacker's unbounded input size — an earlier version capped
 * iterations at a fixed 20, which meant a long enough adversarial `{`/`}` run (hundreds of
 * chars, needing 75+ passes) hit the cap and returned a truncated string that STILL contained
 * `{{`/`}}`, the original bypass hidden behind a length threshold. Every pass that changes the
 * string removes at least 2 characters, so on a `max`-length input it cannot exceed
 * ⌈max/2⌉ passes — the loop below is provably self-terminating and needs no artificial cap.
 * Single braces are left alone by design — the spec only requires stripping the doubled
 * delimiters, and nuking lone braces would mangle legitimate JSON-ish text in a title that
 * appears on the public audit page.
 */
export function sanitize(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  let s = value.slice(0, max);
  for (;;) {
    const next = s.replaceAll("{{", "").replaceAll("}}", "");
    if (next === s) break;
    s = next;
  }
  return s;
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
    // eventId is NOT sanitized or truncated here. It must stay byte-identical to the raw id
    // that verify.ts signed and store.ts deduped on — sanitisation is many-to-one (two distinct
    // raw ids could sanitize to the same value, or diverge only past a 200-char truncation),
    // which would let two different events collide on the same KeeperHub Idempotency-Key while
    // passing the KV duplicate check as "different". Validation (isValidEventId, checked in
    // postOnce before any header is built) is the one-to-one guard for this field instead.
    eventId,
    queryId: sanitize(queryId),
    title: sanitize(source?.title),
    body: sanitize(source?.body),
    // sanitize() only accepts strings and returns "" for anything else, so null must be
    // special-cased here — otherwise "no trigger context" would silently become the string
    // "null" instead of staying null, breaking byte-identical determinism across retries.
    observedValue: observedValue === null ? null : sanitize(observedValue),
    triggerTime: triggerTime === null ? null : sanitize(triggerTime),
  };
}

export function classify(status: number | null): "ok" | "permanent" | "transient" {
  if (status === null) return "transient";
  if (status >= 200 && status < 300) return "ok";
  if (PERMANENT_STATUSES.has(status)) return "permanent";
  return "transient";
}

// Validates (never sanitizes) the eventId used for the Idempotency-Key header and the payload.
// A restrictive allowlist rather than a blocklist: header values are ByteStrings, so blocking
// only \x00-\x1f/\x7f still lets a code point above U+00FF (or \x80-\x9f) through to fetch(),
// which throws there and gets misreported as a transient network failure. Ruling 9: sanitising
// this field is unsafe because it is many-to-one — two distinct raw ids could collapse to the
// same sanitized value, or diverge only past a truncation point, while store.ts's KV dedupe and
// verify.ts's HMAC both still operate on the raw id. So this is a pure accept/reject gate; on
// rejection the raw id is used nowhere and the request never reaches fetch.
export function isValidEventId(eventId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(eventId);
}

function parseRetryAfterMs(res: Response): number | null {
  const header = res.headers.get("Retry-After");
  if (!header) return null;
  const trimmed = header.trim();

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) return null;
    const ms = seconds * 1000;
    if (ms < 0 || ms > MAX_RETRY_AFTER_MS) return null;
    return ms;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  const deltaMs = dateMs - Date.now();
  if (deltaMs < 0 || deltaMs > MAX_RETRY_AFTER_MS) return null;
  return deltaMs;
}

export async function postOnce(env: Env, workflowId: string, payload: ForwardPayload): Promise<PostResult> {
  if (!isValidEventId(payload.eventId)) {
    return {
      status: INVALID_EVENT_ID_STATUS,
      body: "invalid eventId: must match ^[A-Za-z0-9_-]{1,128}$ to form a safe, unambiguous Idempotency-Key header",
      retryAfterMs: null,
    };
  }

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
    return { status: res.status, body: text.slice(0, 500), executionId, retryAfterMs: parseRetryAfterMs(res) };
  } catch (error) {
    return { status: null, body: String(error).slice(0, 500), retryAfterMs: null };
  }
}
