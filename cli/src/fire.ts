import { createHmac } from "node:crypto";

export interface EventOptions {
  eventId: string;
  queryId: string;
  stale?: boolean;
  badSignature?: boolean;
  unrouted?: boolean;
}

export interface BuiltEvent {
  eventId: string;
  timestamp: string;
  signature: string;
  rawBody: string;
}

function signingSecret(): string {
  const value = process.env.ELFA_SIGNING_SECRET;
  if (!value) throw new Error("ELFA_SIGNING_SECRET is not set");
  return value;
}

export function signEvent(
  secret: string,
  eventId: string,
  timestamp: string,
  rawBody: string,
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${rawBody}`)
    .digest("hex");
  return `v1=${signature}`;
}

export function buildEvent(
  options: EventOptions,
  secret = signingSecret(),
): BuiltEvent {
  const nowSec = Math.floor(Date.now() / 1000);
  const timestamp = String(options.stale ? nowSec - 600 : nowSec);
  const numericId = Number(options.eventId);

  const rawBody = JSON.stringify({
    id: Number.isFinite(numericId) && numericId !== 0 ? numericId : 12345,
    type: "athena_query_notify_only",
    category: "alerts",
    title: "BTC funding flips negative (Binance)",
    body: "annualized_rate crossed below 0",
    data: {
      queryId: options.unrouted ? "not-a-routed-query" : options.queryId,
    },
    priority: "high",
    createdAt: new Date().toISOString(),
  });

  const signature = options.badSignature
    ? `v1=${"b".repeat(64)}`
    : signEvent(secret, options.eventId, timestamp, rawBody);

  return { eventId: options.eventId, timestamp, signature, rawBody };
}

export async function runFire(
  options: EventOptions,
): Promise<{ status: number; body: string }> {
  const workerUrl = process.env.WORKER_URL?.replace(/\/$/, "");
  if (!workerUrl) throw new Error("WORKER_URL is not set");

  const event = buildEvent(options);
  const response = await fetch(`${workerUrl}/elfa`, {
    method: "POST",
    headers: {
      "X-Auto-Event-Id": event.eventId,
      "X-Auto-Signature-Timestamp": event.timestamp,
      "X-Auto-Signature": event.signature,
      "Content-Type": "application/json",
    },
    body: event.rawBody,
  });
  const body = await response.text();
  console.log(`${response.status} ${body}`);
  return { status: response.status, body };
}
