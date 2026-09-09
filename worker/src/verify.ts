export interface SignedHeaders {
  eventId: string;
  timestamp: string;
  signature: string;
}

export interface SignedParts extends SignedHeaders {
  rawBody: string;
}

export function readHeaders(h: Headers): SignedHeaders | null {
  const eventId = h.get("X-Auto-Event-Id");
  const timestamp = h.get("X-Auto-Signature-Timestamp");
  const signature = h.get("X-Auto-Signature");
  if (!eventId || !timestamp || !signature) return null;
  return { eventId, timestamp, signature };
}

function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(secret: string, parts: SignedParts): Promise<boolean> {
  if (!parts.signature.startsWith("v1=")) return false;
  const given = parts.signature.slice(3).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${parts.timestamp}.${parts.eventId}.${parts.rawBody}`),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return equalsConstantTime(given, expected);
}

export function isFresh(timestamp: string, nowSec: number, windowSec = 30): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSec - ts) <= windowSec;
}
