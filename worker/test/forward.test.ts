import { env } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitize, extractContext, buildPayload, classify, RETRY_DELAYS_MS, postOnce } from "../src/forward";

describe("sanitize", () => {
  it("strips template braces so external text can never become a KeeperHub template", () => {
    expect(sanitize("{{@bal-1:Check Balance.balance}}")).toBe("@bal-1:Check Balance.balance");
  });
  it("truncates to 200 characters", () => {
    expect(sanitize("x".repeat(500))).toHaveLength(200);
  });
  it("returns an empty string for non-strings", () => {
    expect(sanitize(undefined)).toBe("");
    expect(sanitize(42)).toBe("");
  });

  it("strips interleaved braces that a single pass would miss, leaving no re-formed {{ or }}", () => {
    // "{}}{" survives a single "{{" pass unchanged, then stripping "}}" re-forms "{{" —
    // a single-pass strip would leak this. Loop-to-fixed-point must catch it.
    for (const input of ["{}}{", "{{{{", "{{}}{{"]) {
      const out = sanitize(input);
      expect(out).not.toContain("{{");
      expect(out).not.toContain("}}");
    }
  });

  it("leaves lone single braces alone, only removing the doubled delimiter", () => {
    expect(sanitize("{ {")).toBe("{ {");
  });
});

describe("extractContext", () => {
  it("reads the observed value and time when trigger context is present", () => {
    const body = {
      trigger: { time: "2026-04-01T12:00:00.000Z", matchedConditions: [{ match: { observedValue: -3.21 } }] },
    };
    expect(extractContext(body)).toEqual({ observedValue: "-3.21", triggerTime: "2026-04-01T12:00:00.000Z" });
  });

  it("returns nulls when trigger context is absent, which is the documented webhook body", () => {
    const body = { id: 12345, title: "t", body: "b", data: { queryId: "q1" } };
    expect(extractContext(body)).toEqual({ observedValue: null, triggerTime: null });
  });

  it("returns nulls rather than throwing on a partially shaped context", () => {
    expect(extractContext({ trigger: { matchedConditions: [] } })).toEqual({ observedValue: null, triggerTime: null });
  });
});

describe("buildPayload", () => {
  it("is byte-identical for the same event, so the idempotency key stays valid", () => {
    const body = { title: "BTC funding flips negative (Binance)", body: "crossed below 0", data: { queryId: "q1" } };
    const a = JSON.stringify(buildPayload("42", "q1", body));
    const b = JSON.stringify(buildPayload("42", "q1", body));
    expect(a).toBe(b);
  });

  it("carries no amount, address, token or chain field", () => {
    const payload = buildPayload("42", "q1", { title: "t", body: "b" });
    const forbidden = ["amount", "amountIn", "amountOut", "value", "ethValue", "address", "recipient", "token", "tokenIn", "tokenOut", "chainId", "network", "fee"];
    for (const key of Object.keys(payload)) {
      expect(forbidden).not.toContain(key);
    }
  });

  it("has exactly the payload's declared shape and no more", () => {
    const payload = buildPayload("42", "q1", { title: "t", body: "b" });
    expect(Object.keys(payload).sort()).toEqual(
      ["source", "eventId", "queryId", "title", "body", "observedValue", "triggerTime"].sort(),
    );
  });

  it("has no timestamp field", () => {
    expect(Object.keys(buildPayload("42", "q1", {}))).not.toContain("receivedAt");
  });

  it("sanitizes every string-valued field, not just title and body", () => {
    const body = {
      title: "{{tpl}}t",
      body: "{{tpl}}b",
      trigger: {
        time: "{{tpl}}2026-04-01T12:00:00.000Z",
        matchedConditions: [{ match: { observedValue: "{{tpl}}-3.21" } }],
      },
    };
    const payload = buildPayload("ev{{1}}", "q{{1}}", body);
    expect(payload.eventId).toBe("ev1");
    expect(payload.queryId).toBe("q1");
    expect(payload.title).toBe("tplt");
    expect(payload.body).toBe("tplb");
    expect(payload.observedValue).toBe("tpl-3.21");
    expect(payload.triggerTime).toBe("tpl2026-04-01T12:00:00.000Z");
  });

  it("keeps observedValue and triggerTime as null, not the string \"null\", when absent", () => {
    const payload = buildPayload("42", "q1", { title: "t", body: "b" });
    expect(payload.observedValue).toBeNull();
    expect(payload.triggerTime).toBeNull();
  });
});

describe("classify", () => {
  it("treats 2xx as ok", () => {
    expect(classify(200)).toBe("ok");
    expect(classify(202)).toBe("ok");
  });
  it("treats client errors we cannot fix by retrying as permanent", () => {
    for (const s of [400, 401, 403, 404, 410]) expect(classify(s)).toBe("permanent");
  });
  it("treats rate limits and server errors as transient", () => {
    for (const s of [429, 500, 502, 503]) expect(classify(s)).toBe("transient");
  });
  it("treats a network failure as transient", () => {
    expect(classify(null)).toBe("transient");
  });
});

describe("RETRY_DELAYS_MS", () => {
  it("backs off three times", () => {
    expect(RETRY_DELAYS_MS).toEqual([2000, 10000, 30000]);
  });
});

describe("postOnce", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts to the /webhook path with the bearer key and an idempotency key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ executionId: "x1", status: "running" }), { status: 200 }),
    );
    const payload = buildPayload("42", "q1", { title: "t", body: "b" });
    const result = await postOnce({ ...env, KEEPERHUB_BASE: "https://app.keeperhub.com", KEEPERHUB_WEBHOOK_KEY: "wfb_test" }, "wf1", payload);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.keeperhub.com/api/workflows/wf1/webhook");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer wfb_test");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("elfa-42");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(result).toMatchObject({ status: 200, executionId: "x1" });
  });

  it("rejects an eventId containing CR/LF as permanent, without attempting a network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const payload = buildPayload("42\r\nX-Injected: yes", "q1", { title: "t", body: "b" });
    const result = await postOnce({ ...env, KEEPERHUB_BASE: "https://app.keeperhub.com", KEEPERHUB_WEBHOOK_KEY: "wfb_test" }, "wf1", payload);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(classify(result.status)).toBe("permanent");
    expect(result.retryAfterMs).toBeNull();
  });

  it("returns a null status instead of throwing when the network fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection reset"));
    const result = await postOnce({ ...env, KEEPERHUB_BASE: "https://app.keeperhub.com", KEEPERHUB_WEBHOOK_KEY: "wfb_test" }, "wf1", buildPayload("42", "q1", {}));
    expect(result.status).toBeNull();
    expect(result.body).toContain("connection reset");
  });

  it("truncates a long error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("e".repeat(5000), { status: 500 }));
    const result = await postOnce({ ...env, KEEPERHUB_BASE: "https://app.keeperhub.com", KEEPERHUB_WEBHOOK_KEY: "wfb_test" }, "wf1", buildPayload("42", "q1", {}));
    expect(result.body.length).toBeLessThanOrEqual(500);
  });

  it("keeps a JSON error body as a plain truncated string, never parsed JSON, so it stays under the KV metadata cap", async () => {
    const bigErrorObject = { error: "workflow validation failed", details: "d".repeat(2000) };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(bigErrorObject), { status: 400 }));
    const result = await postOnce({ ...env, KEEPERHUB_BASE: "https://app.keeperhub.com", KEEPERHUB_WEBHOOK_KEY: "wfb_test" }, "wf1", buildPayload("42", "q1", {}));
    expect(typeof result.body).toBe("string");
    expect(result.body.length).toBeLessThanOrEqual(500);
  });

  it("sends the exact same idempotency key and byte-identical body on a retry of the same event", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ executionId: "x2" }), { status: 200 }));

    const testEnv = { ...env, KEEPERHUB_BASE: "https://app.keeperhub.com", KEEPERHUB_WEBHOOK_KEY: "wfb_test" };
    const payload = buildPayload("77", "q1", { title: "t", body: "b" });

    const first = await postOnce(testEnv, "wf1", payload);
    const second = await postOnce(testEnv, "wf1", payload);

    expect(classify(first.status)).toBe("transient");
    expect(classify(second.status)).toBe("ok");

    const [, firstInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [, secondInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    const firstHeaders = firstInit.headers as Record<string, string>;
    const secondHeaders = secondInit.headers as Record<string, string>;

    expect(firstHeaders["Idempotency-Key"]).toBe("elfa-77");
    expect(secondHeaders["Idempotency-Key"]).toBe("elfa-77");
    expect(firstHeaders["Idempotency-Key"]).toBe(secondHeaders["Idempotency-Key"]);
    expect(firstInit.body).toBe(secondInit.body);
  });

  describe("Retry-After", () => {
    const testEnv = () => ({ ...env, KEEPERHUB_BASE: "https://app.keeperhub.com", KEEPERHUB_WEBHOOK_KEY: "wfb_test" });
    const post = () => postOnce(testEnv(), "wf1", buildPayload("42", "q1", {}));

    it("parses a delta-seconds value into milliseconds", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "5" } }));
      const result = await post();
      expect(result.retryAfterMs).toBe(5000);
    });

    it("parses an HTTP-date value into milliseconds until that date", async () => {
      const future = new Date(Date.now() + 15000);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": future.toUTCString() } }));
      const result = await post();
      expect(result.retryAfterMs).not.toBeNull();
      expect(result.retryAfterMs as number).toBeGreaterThan(10000);
      expect(result.retryAfterMs as number).toBeLessThanOrEqual(15000);
    });

    it("falls back to null for a malformed value", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "not-a-value" } }));
      const result = await post();
      expect(result.retryAfterMs).toBeNull();
    });

    it("falls back to null for a negative delta-seconds value", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "-5" } }));
      const result = await post();
      expect(result.retryAfterMs).toBeNull();
    });

    it("falls back to null for an absurdly large value", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "999999999" } }));
      const result = await post();
      expect(result.retryAfterMs).toBeNull();
    });

    it("is null when the header is absent", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      const result = await post();
      expect(result.retryAfterMs).toBeNull();
    });
  });
});
