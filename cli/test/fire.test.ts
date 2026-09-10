import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvent, runFire, signEvent } from "../src/fire";
import { summarizeExecution } from "../src/status";
import {
  normalizeElfaPlans,
  selectRoutedActivePlans,
} from "../src/teardown";

const SECRET = "a".repeat(64);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("signEvent", () => {
  it("signs timestamp.eventId.body with the raw secret", () => {
    const body = '{"id":1}';
    const expected = createHmac("sha256", SECRET)
      .update(`1775035200.42.${body}`)
      .digest("hex");

    expect(signEvent(SECRET, "42", "1775035200", body)).toBe(
      `v1=${expected}`,
    );
  });
});

describe("buildEvent", () => {
  it("uses Elfa's documented notification shape", () => {
    const event = buildEvent({ eventId: "42", queryId: "q1" }, SECRET);
    const parsed = JSON.parse(event.rawBody);
    expect(parsed).toMatchObject({
      type: "athena_query_notify_only",
      data: { queryId: "q1" },
    });
    expect(parsed).toHaveProperty("title");
    expect(parsed).toHaveProperty("createdAt");
  });

  it("backdates the signature timestamp for a stale event", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const event = buildEvent(
      { eventId: "42", queryId: "q1", stale: true },
      SECRET,
    );
    expect(nowSec - Number(event.timestamp)).toBeGreaterThan(30);
  });

  it("produces a signature that fails verification on request", () => {
    const good = buildEvent({ eventId: "42", queryId: "q1" }, SECRET);
    const bad = buildEvent(
      { eventId: "42", queryId: "q1", badSignature: true },
      SECRET,
    );
    expect(bad.signature).not.toBe(good.signature);
  });

  it("uses an unrouted query id on request", () => {
    const event = buildEvent(
      { eventId: "42", queryId: "q1", unrouted: true },
      SECRET,
    );
    expect(JSON.parse(event.rawBody).data.queryId).toBe("not-a-routed-query");
  });
});

describe("runFire", () => {
  it("sends the exact signed bytes and Elfa headers", async () => {
    vi.stubEnv("WORKER_URL", "https://bridge.example/");
    vi.stubEnv("ELFA_SIGNING_SECRET", SECRET);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forwarded:ok", { status: 200 }),
    );

    const result = await runFire({ eventId: "42", queryId: "q1" });

    expect(result).toEqual({ status: 200, body: "forwarded:ok" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://bridge.example/elfa");
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    expect(headers.get("X-Auto-Event-Id")).toBe("42");
    expect(headers.get("X-Auto-Signature")).toBe(
      signEvent(SECRET, "42", headers.get("X-Auto-Signature-Timestamp")!, body),
    );
  });
});

describe("teardown scope", () => {
  const response = {
    queries: [
      { id: "routed-active", status: "active", title: "ours" },
      { id: "other-active", status: "active", title: "someone else's" },
      { id: "routed-cancelled", status: "cancelled", title: "old" },
    ],
  };

  it("normalizes the live Elfa queries response", () => {
    expect(normalizeElfaPlans(response)).toHaveLength(3);
  });

  it("selects only active plans routed by this project", () => {
    expect(
      selectRoutedActivePlans(normalizeElfaPlans(response), {
        "routed-active": "wf1",
        "routed-cancelled": "wf1",
      }),
    ).toEqual([{ id: "routed-active", status: "active", title: "ours" }]);
  });
});

describe("status output", () => {
  it("keeps transaction proof while omitting execution metadata", () => {
    const summary = summarizeExecution({
      id: "ex-1",
      status: "success",
      completedAt: "2026-09-10T02:09:21.874Z",
      triggeredByIp: "192.0.2.1",
      input: { secret: "do not print" },
      transactionHashes: [
        { hash: "0xabc", chainId: 8453, verified: true },
      ],
    });

    expect(summary).toEqual({
      id: "ex-1",
      status: "success",
      completedAt: "2026-09-10T02:09:21.874Z",
      transactions: [{ hash: "0xabc", chainId: 8453, verified: true }],
    });
    expect(JSON.stringify(summary)).not.toContain("192.0.2.1");
    expect(JSON.stringify(summary)).not.toContain("do not print");
  });
});
