import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { decisionKey, seenBefore, markSeen, recordDecision, recentDecisions, storeRaw } from "../src/store";

async function wipe() {
  const list = await env.BRIDGE.list();
  await Promise.all(list.keys.map((k) => env.BRIDGE.delete(k.name)));
}

describe("dedupe marks", () => {
  beforeEach(wipe);

  it("reports an unseen event id as unseen", async () => {
    expect(await seenBefore(env.BRIDGE, "e1")).toBe(false);
  });

  it("reports a marked event id as seen", async () => {
    await markSeen(env.BRIDGE, "e1");
    expect(await seenBefore(env.BRIDGE, "e1")).toBe(true);
  });

  it("keeps different event ids independent", async () => {
    await markSeen(env.BRIDGE, "e1");
    expect(await seenBefore(env.BRIDGE, "e2")).toBe(false);
  });
});

describe("decisionKey", () => {
  it("orders newer records before older ones lexicographically", () => {
    const older = decisionKey("e1", 1_700_000_000_000);
    const newer = decisionKey("e2", 1_700_000_060_000);
    expect(newer < older).toBe(true);
  });

  it("always produces a fixed-width reverse component", () => {
    const key = decisionKey("e1", 1_700_000_000_000);
    expect(key.split(":")[1]).toHaveLength(13);
  });
});

describe("decision records", () => {
  beforeEach(wipe);

  it("round-trips a record through metadata", async () => {
    await recordDecision(env.BRIDGE, {
      at: new Date(1_700_000_000_000).toISOString(),
      eventId: "e1",
      queryId: "q1",
      decision: "forwarded:ok",
      detail: { executionId: "x1" },
      latencyMs: 120,
    });
    const [record] = await recentDecisions(env.BRIDGE);
    expect(record).toMatchObject({ eventId: "e1", decision: "forwarded:ok", detail: { executionId: "x1" } });
  });

  it("returns newest first", async () => {
    await recordDecision(env.BRIDGE, { at: new Date(1_700_000_000_000).toISOString(), eventId: "old", queryId: null, decision: "dropped:duplicate" });
    await recordDecision(env.BRIDGE, { at: new Date(1_700_000_060_000).toISOString(), eventId: "new", queryId: null, decision: "forwarded:ok" });
    const records = await recentDecisions(env.BRIDGE);
    expect(records.map((r) => r.eventId)).toEqual(["new", "old"]);
  });

  it("honours the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await recordDecision(env.BRIDGE, { at: new Date(1_700_000_000_000 + i * 1000).toISOString(), eventId: `e${i}`, queryId: null, decision: "forwarded:ok" });
    }
    expect(await recentDecisions(env.BRIDGE, 3)).toHaveLength(3);
  });

  it("does not mix raw bodies into the decision listing", async () => {
    await storeRaw(env.BRIDGE, "e1", '{"id":1}');
    await recordDecision(env.BRIDGE, { at: new Date().toISOString(), eventId: "e1", queryId: null, decision: "forwarded:ok" });
    expect(await recentDecisions(env.BRIDGE)).toHaveLength(1);
    expect(await env.BRIDGE.get("raw:e1")).toBe('{"id":1}');
  });
});
