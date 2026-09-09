import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker from "../src/index";

const SECRET = "a".repeat(64);

async function wipe() {
  const list = await env.BRIDGE.list();
  await Promise.all(list.keys.map((k) => env.BRIDGE.delete(k.name)));
}

async function signedRequest(opts: {
  eventId?: string;
  queryId?: string;
  timestampOffset?: number;
  breakSignature?: boolean;
  omitHeader?: boolean;
}): Promise<Request> {
  const eventId = opts.eventId ?? "42";
  const timestamp = String(Math.floor(Date.now() / 1000) + (opts.timestampOffset ?? 0));
  const rawBody = JSON.stringify({
    id: 12345,
    title: "BTC funding flips negative (Binance)",
    body: "annualized_rate crossed below 0",
    data: { queryId: opts.queryId ?? "q1" },
  });

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${eventId}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const headers: Record<string, string> = {
    "X-Auto-Event-Id": eventId,
    "X-Auto-Signature-Timestamp": timestamp,
    "X-Auto-Signature": `v1=${opts.breakSignature ? "b".repeat(64) : hex}`,
    "Content-Type": "application/json",
  };
  if (opts.omitHeader) delete headers["X-Auto-Signature"];

  return new Request("https://bridge.test/elfa", { method: "POST", headers, body: rawBody });
}

function testEnv(overrides: Partial<typeof env> = {}) {
  return {
    ...env,
    ELFA_SIGNING_SECRET: SECRET,
    KEEPERHUB_WEBHOOK_KEY: "wfb_test",
    KEEPERHUB_BASE: "https://app.keeperhub.com",
    BRIDGE_ENABLED: "true",
    ROUTES: JSON.stringify({ q1: "wf1" }),
    ...overrides,
  };
}

async function call(request: Request, e = testEnv()) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, e as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /elfa", () => {
  beforeEach(wipe);
  afterEach(() => vi.restoreAllMocks());

  it("forwards a valid event and records the execution id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x1" }), { status: 200 }));
    const res = await call(await signedRequest({}));
    expect(res.status).toBe(200);

    const audit = await (await call(new Request("https://bridge.test/audit"))).json();
    expect(audit[0]).toMatchObject({ decision: "forwarded:ok", detail: { executionId: "x1" } });
  });

  it("rejects a bad signature and writes NOTHING to KV", async () => {
    const res = await call(await signedRequest({ breakSignature: true }));
    expect(res.status).toBe(401);
    expect((await env.BRIDGE.list()).keys).toHaveLength(0);
  });

  it("rejects a missing header with 400 and writes nothing", async () => {
    const res = await call(await signedRequest({ omitHeader: true }));
    expect(res.status).toBe(400);
    expect((await env.BRIDGE.list()).keys).toHaveLength(0);
  });

  it("checks the signature BEFORE the freshness window", async () => {
    // Stale AND badly signed: the signature verdict must win, proving order.
    const res = await call(await signedRequest({ timestampOffset: -600, breakSignature: true }));
    expect(res.status).toBe(401);
    const audit = await (await call(new Request("https://bridge.test/audit"))).json();
    expect(audit).toHaveLength(0);
  });

  it("refuses a stale but correctly signed event and records it", async () => {
    const res = await call(await signedRequest({ timestampOffset: -600 }));
    expect(res.status).toBe(401);
    const audit = await (await call(new Request("https://bridge.test/audit"))).json();
    expect(audit[0]).toMatchObject({ decision: "refused:stale" });
  });

  it("drops a duplicate event id without a second forward", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x1" }), { status: 200 }));
    await call(await signedRequest({ eventId: "dup" }));
    await call(await signedRequest({ eventId: "dup" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const audit = await (await call(new Request("https://bridge.test/audit"))).json();
    expect(audit.map((d: { decision: string }) => d.decision)).toContain("dropped:duplicate");
  });

  it("forwards nothing when the kill switch is off", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call(await signedRequest({}), testEnv({ BRIDGE_ENABLED: "false" } as never));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const audit = await (await call(new Request("https://bridge.test/audit"))).json();
    expect(audit[0]).toMatchObject({ decision: "dropped:kill_switch" });
  });

  it("drops an event whose query id is not routed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await call(await signedRequest({ queryId: "unknown" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    const audit = await (await call(new Request("https://bridge.test/audit"))).json();
    expect(audit[0]).toMatchObject({ decision: "dropped:unrouted" });
  });

  it("records a permanent KeeperHub error with its body and does not retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("invalid integration references", { status: 403 }));
    const res = await call(await signedRequest({}));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const audit = await (await call(new Request("https://bridge.test/audit"))).json();
    expect(audit[0]).toMatchObject({ decision: "forwarded:permanent_error" });
    expect(audit[0].detail.body).toContain("invalid integration references");
  });

  it("stores the raw body of the first delivery so trigger context can be mapped from evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x1" }), { status: 200 }));
    await call(await signedRequest({ eventId: "raw1" }));
    expect(await env.BRIDGE.get("raw:raw1")).toContain("BTC funding flips negative");
  });

  it("never leaks a secret through the audit page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x1" }), { status: 200 }));
    await call(await signedRequest({}));
    const text = await (await call(new Request("https://bridge.test/audit"))).text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("wfb_test");
  });

  it("rejects a malformed eventId with 400 before any KV write", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call(await signedRequest({ eventId: "bad id with spaces!" }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await env.BRIDGE.list()).keys).toHaveLength(0);
  });
});

describe("GET /audit", () => {
  beforeEach(wipe);
  it("renders HTML when asked", async () => {
    const res = await call(new Request("https://bridge.test/audit?format=html"));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<table");
  });
});
