import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker, { forwardWithRetry } from "../src/index";
import type { ForwardPayload } from "../src/forward";
import type { Decision } from "../src/store";

const SECRET = "a".repeat(64);

interface AuditRow {
  eventId: string;
  queryId: string | null;
  decision: string;
  detail: Record<string, unknown>;
}

async function readAudit(): Promise<AuditRow[]> {
  return (await (await call(new Request("https://bridge.test/audit"))).json()) as AuditRow[];
}

async function wipe() {
  const list = await env.BRIDGE.list();
  await Promise.all(list.keys.map((k) => env.BRIDGE.delete(k.name)));
}

async function signedRequest(opts: {
  eventId?: string;
  queryId?: unknown;
  timestampOffset?: number;
  breakSignature?: boolean;
  omitHeader?: boolean;
  body?: unknown;
}): Promise<Request> {
  const eventId = opts.eventId ?? "42";
  const timestamp = String(Math.floor(Date.now() / 1000) + (opts.timestampOffset ?? 0));
  const rawBody = JSON.stringify(
    opts.body ?? {
      id: 12345,
      title: "BTC funding flips negative (Binance)",
      body: "annualized_rate crossed below 0",
      data: { queryId: opts.queryId ?? "q1" },
    },
  );

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

/** A KV namespace whose `put` throws for any key starting with `prefix` (empty prefix = every
 * key) and otherwise delegates to the real binding. Used to force a specific persistence call
 * (recordDecision / markSeen / storeRaw, distinguished by their key prefixes) to fail without
 * touching the others. */
function kvThatFailsPutFor(prefix: string): typeof env.BRIDGE {
  const real = env.BRIDGE;
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "put") {
        return async (key: string, ...rest: unknown[]) => {
          if (key.startsWith(prefix)) throw new Error(`kv put failed for ${key}`);
          return (target.put as (...a: unknown[]) => unknown)(key, ...rest);
        };
      }
      const value = (target as unknown as Record<string, unknown>)[prop as string];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe("POST /elfa", () => {
  beforeEach(wipe);
  afterEach(() => vi.restoreAllMocks());

  it("forwards a valid event and records the execution id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x1" }), { status: 200 }));
    const res = await call(await signedRequest({}));
    expect(res.status).toBe(200);

    const audit = await readAudit();
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
    const audit = await readAudit();
    expect(audit).toHaveLength(0);
  });

  it("refuses a stale but correctly signed event and records it", async () => {
    const res = await call(await signedRequest({ timestampOffset: -600 }));
    expect(res.status).toBe(401);
    const audit = await readAudit();
    expect(audit[0]).toMatchObject({ decision: "refused:stale" });
  });

  it("drops a duplicate event id without a second forward", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x1" }), { status: 200 }));
    await call(await signedRequest({ eventId: "dup" }));
    await call(await signedRequest({ eventId: "dup" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const audit = await readAudit();
    expect(audit.map((d: { decision: string }) => d.decision)).toContain("dropped:duplicate");
  });

  it("forwards nothing when the kill switch is off", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call(await signedRequest({}), testEnv({ BRIDGE_ENABLED: "false" } as never));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const audit = await readAudit();
    expect(audit[0]).toMatchObject({ decision: "dropped:kill_switch" });
  });

  it("drops an event whose query id is not routed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await call(await signedRequest({ queryId: "unknown" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    const audit = await readAudit();
    expect(audit[0]).toMatchObject({ decision: "dropped:unrouted" });
  });

  it("drops a signed lifecycle notification even when its top-level query id is routed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call(
      await signedRequest({
        eventId: "expired-event",
        body: {
          status: "expired",
          queryId: "q1",
          title: "Plan Expired",
          body: "The plan reached its expiry time",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("dropped:lifecycle");
    expect(fetchSpy).not.toHaveBeenCalled();
    const audit = await readAudit();
    expect(audit[0]).toMatchObject({
      queryId: "q1",
      decision: "dropped:lifecycle",
    });
  });

  it("accepts the documented top-level query id on a triggered notification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ executionId: "x-top-level" }), { status: 200 }),
    );
    const res = await call(
      await signedRequest({
        eventId: "triggered-event",
        body: {
          status: "triggered",
          queryId: "q1",
          title: "Plan Triggered",
          body: "BTC crossed the threshold",
        },
      }),
    );

    expect(res.status).toBe(200);
    const audit = await readAudit();
    expect(audit[0]).toMatchObject({
      queryId: "q1",
      decision: "forwarded:ok",
      detail: { executionId: "x-top-level" },
    });
  });

  it("treats a non-string query id as unrouted instead of throwing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call(await signedRequest({ queryId: { malformed: true } }));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const audit = await readAudit();
    expect(audit[0]).toMatchObject({
      queryId: null,
      decision: "dropped:unrouted",
    });
  });

  it("records a permanent KeeperHub error with its body and does not retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("invalid integration references", { status: 403 }));
    const res = await call(await signedRequest({}));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const audit = await readAudit();
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

  // FINDING 1: a queryId that shadows an inherited Object.prototype member ("constructor",
  // "__proto__", "toString", "valueOf") must never resolve to a truthy workflow id via a
  // prototype-chain lookup. It must be treated exactly like any other unrouted queryId: no
  // fetch, no seen:/raw: KV write, dropped:unrouted.
  it("treats prototype-chain queryIds as unrouted, not a routing bypass", async () => {
    for (const bait of ["constructor", "__proto__", "toString", "valueOf"]) {
      await wipe();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const res = await call(await signedRequest({ queryId: bait }));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();

      const keys = (await env.BRIDGE.list()).keys.map((k) => k.name);
      expect(keys.filter((k) => k.startsWith("seen:") || k.startsWith("raw:"))).toHaveLength(0);

      const audit = await readAudit();
      expect(audit[0]).toMatchObject({ decision: "dropped:unrouted" });
      fetchSpy.mockRestore();
    }
  });

  // FINDING 2: an oversized top-level queryId must not push the decision record's metadata
  // past Cloudflare's 1024-byte cap and make kv.put throw. The record must still be written,
  // bounded to the same 200-char budget as title/body/observedValue.
  it("still writes a decision record for an oversized queryId instead of losing it to the KV metadata cap", async () => {
    const hugeQueryId = "x".repeat(5000);
    const res = await call(await signedRequest({ queryId: hugeQueryId }));
    expect(res.status).toBe(200);

    const audit = await readAudit();
    expect(audit[0]).toMatchObject({ decision: "dropped:unrouted" });
    expect(typeof audit[0].queryId).toBe("string");
    expect(audit[0].queryId!.length).toBeLessThanOrEqual(200);
  });

  // FINDING 3: a KV failure while persisting the decision record must not turn the spec's
  // "always 200 after signature verification" into a 500 — that 500 is exactly the retry-storm
  // the whole design exists to prevent. The failure must instead be counted and surfaced on
  // /health.
  it("returns 200 even when persisting the decision record fails, and counts it on /health", async () => {
    const before = (await (await call(new Request("https://bridge.test/health"))).json()) as { failedPersists: number };

    const res = await call(await signedRequest({}), testEnv({ BRIDGE_ENABLED: "false", BRIDGE: kvThatFailsPutFor("") } as never));
    expect(res.status).toBe(200);

    const after = (await (await call(new Request("https://bridge.test/health"))).json()) as { failedPersists: number };
    expect(after.failedPersists).toBeGreaterThan(before.failedPersists);
  });

  // ROUND 2, ITEM 1 (Ruling 10): markSeen and storeRaw must fail open exactly like
  // recordDecision — a KV outage on either must not turn a 200 into a 500 (which would make
  // Elfa retry the whole delivery, the retry-storm the design exists to prevent), and the
  // forward must still go ahead since KeeperHub's own Idempotency-Key is the real dedupe guard.
  it("returns 200 and still forwards when markSeen fails to persist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x9" }), { status: 200 }));
    const before = (await (await call(new Request("https://bridge.test/health"))).json()) as { failedPersists: number };

    const res = await call(await signedRequest({ eventId: "markseen-fail" }), testEnv({ BRIDGE: kvThatFailsPutFor("seen:") } as never));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const after = (await (await call(new Request("https://bridge.test/health"))).json()) as { failedPersists: number };
    expect(after.failedPersists).toBeGreaterThan(before.failedPersists);
  });

  it("returns 200 and still forwards when storeRaw fails to persist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ executionId: "x10" }), { status: 200 }));
    const before = (await (await call(new Request("https://bridge.test/health"))).json()) as { failedPersists: number };

    const res = await call(await signedRequest({ eventId: "storeraw-fail" }), testEnv({ BRIDGE: kvThatFailsPutFor("raw:") } as never));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const after = (await (await call(new Request("https://bridge.test/health"))).json()) as { failedPersists: number };
    expect(after.failedPersists).toBeGreaterThan(before.failedPersists);
  });

  // ROUND 2, ITEM 2: queryId must be bounded once, before it ever reaches a Decision base —
  // including the decision records written directly inside forwardWithRetry's background retry
  // loop, which never pass through `finish`'s own bounding.
  it("bounds an oversized routed queryId once, at decisionBase construction — not only via finish", async () => {
    // A permanent-error forward resolves synchronously inside forwardWithRetry (no
    // ctx.waitUntil), so this proves decisionBase itself carries the bounded value: every
    // branch in forwardWithRetry, including the ones the background retry loop writes directly
    // via safeRecordDecision, spreads this same shared `base` object.
    const hugeRoutedQueryId = "q".repeat(5000);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 403 }));
    const res = await call(
      await signedRequest({ eventId: "bound-check", queryId: hugeRoutedQueryId }),
      testEnv({ ROUTES: JSON.stringify({ [hugeRoutedQueryId]: "wf1" }) } as never),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const audit = await readAudit();
    expect(audit[0]).toMatchObject({ decision: "forwarded:permanent_error" });
    expect(audit[0].queryId!.length).toBeLessThanOrEqual(200);
  });

  // ROUND 2, ITEM 3: a non-string ROUTES value is dropped silently from routing, but must not be
  // invisible — a config typo should be diagnosable from /health rather than reading forever as
  // plain "unrouted" traffic.
  it("surfaces malformed ROUTES entries on /health instead of dropping them silently", async () => {
    const health = (await (
      await call(new Request("https://bridge.test/health"), testEnv({ ROUTES: JSON.stringify({ q1: "wf1", q2: 12345 }) } as never))
    ).json()) as { routes: number; malformedRoutes: number };
    expect(health.routes).toBe(1);
    expect(health.malformedRoutes).toBe(1);
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

// FINDING 4: forwardWithRetry's background loop was previously untestable — real setTimeout at
// 2s/10s/30s. It now takes an injectable `sleep` dependency (defaulting to the real timer in
// production) so these tests can supply an instant fake instead of waiting on the wall clock.
describe("retry runner (forwardWithRetry)", () => {
  beforeEach(wipe);
  afterEach(() => vi.restoreAllMocks());

  function retryEnv() {
    return {
      ...env,
      ELFA_SIGNING_SECRET: SECRET,
      KEEPERHUB_WEBHOOK_KEY: "wfb_test",
      KEEPERHUB_BASE: "https://app.keeperhub.com",
      BRIDGE_ENABLED: "true",
      ROUTES: JSON.stringify({ q1: "wf1" }),
    } as never;
  }

  function payload(eventId: string): ForwardPayload {
    return {
      source: "elfa-auto",
      eventId,
      queryId: "q1",
      title: "t",
      body: "b",
      observedValue: null,
      triggerTime: null,
    };
  }

  function base(eventId: string): Decision {
    return { at: new Date().toISOString(), eventId, queryId: "q1", decision: "" };
  }

  async function latestDecision(): Promise<Decision> {
    const listed = await env.BRIDGE.list<Decision>({ prefix: "decision:" });
    return listed.keys[0].metadata as Decision;
  }

  it("succeeds on the second attempt and records forwarded:ok_after_retry", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls++;
      if (calls === 1) return new Response("server error", { status: 500 });
      return new Response(JSON.stringify({ executionId: "x2" }), { status: 200 });
    });
    const ctx = createExecutionContext();
    const delays: number[] = [];
    const fakeSleep = async (ms: number) => {
      delays.push(ms);
    };

    const outcome = await forwardWithRetry(retryEnv(), ctx, "wf1", payload("retry-1"), base("retry-1"), fakeSleep);
    expect(outcome.decision).toBe("forwarded:retrying");
    await waitOnExecutionContext(ctx);

    const stored = await latestDecision();
    expect(stored.decision).toBe("forwarded:ok_after_retry");
    expect(stored.detail).toMatchObject({ executionId: "x2" });
    expect(delays).toEqual([2000]);
  });

  it("gives up after exhausting all retry attempts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("still down", { status: 500 }));
    const ctx = createExecutionContext();
    const delays: number[] = [];
    const fakeSleep = async (ms: number) => {
      delays.push(ms);
    };

    await forwardWithRetry(retryEnv(), ctx, "wf1", payload("retry-2"), base("retry-2"), fakeSleep);
    await waitOnExecutionContext(ctx);

    const stored = await latestDecision();
    expect(stored.decision).toBe("forwarded:gave_up");
    expect(delays).toEqual([2000, 10000, 30000]);
  });

  it("reuses the same Idempotency-Key and the same payload bytes on every attempt", async () => {
    const idempotencyKeys: string[] = [];
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      idempotencyKeys.push(headers["Idempotency-Key"]);
      bodies.push(String(init?.body));
      return new Response("still down", { status: 500 });
    });
    const ctx = createExecutionContext();
    const fakeSleep = async () => {};

    await forwardWithRetry(retryEnv(), ctx, "wf1", payload("retry-3"), base("retry-3"), fakeSleep);
    await waitOnExecutionContext(ctx);

    expect(idempotencyKeys.length).toBeGreaterThan(1);
    expect(new Set(idempotencyKeys)).toEqual(new Set(["elfa-retry-3"]));
    expect(new Set(bodies).size).toBe(1);
  });

  it("honours a retryAfterMs returned on the SECOND attempt before scheduling the third", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls++;
      if (calls === 2) return new Response("rate limited", { status: 429, headers: { "Retry-After": "5" } });
      if (calls === 3) return new Response(JSON.stringify({ executionId: "x3" }), { status: 200 });
      return new Response("server error", { status: 500 });
    });
    const ctx = createExecutionContext();
    const delays: number[] = [];
    const fakeSleep = async (ms: number) => {
      delays.push(ms);
    };

    await forwardWithRetry(retryEnv(), ctx, "wf1", payload("retry-4"), base("retry-4"), fakeSleep);
    await waitOnExecutionContext(ctx);

    // delays[0]: before the 2nd fetch call. The FIRST postOnce carried no Retry-After, so this
    // is the default RETRY_DELAYS_MS[0] = 2000.
    // delays[1]: before the 3rd fetch call. The SECOND attempt returned Retry-After: 5s, so this
    // must be 5000 — not the default RETRY_DELAYS_MS[1] = 10000. This is the exact bug the
    // `last.retryAfterMs` fix addresses; without it this assertion fails with 10000.
    expect(delays).toEqual([2000, 5000]);

    const stored = await latestDecision();
    expect(stored.decision).toBe("forwarded:ok_after_retry");
  });
});
