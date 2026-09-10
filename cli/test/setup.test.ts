import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertWorkerReachable,
  extractCreatedQueryId,
  mergeRoutes,
  parseRoutesFromToml,
  updateWranglerVars,
} from "../src/setup";

afterEach(() => vi.restoreAllMocks());

describe("assertWorkerReachable", () => {
  it("accepts a healthy Worker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: true }, { status: 200 }),
    );

    await expect(assertWorkerReachable("https://bridge.example")).resolves.toBeUndefined();
  });

  it("explains the deployment requirement on a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND"),
    );

    await expect(assertWorkerReachable("https://bridge.example")).rejects.toThrow(
      /deploy the Worker first/i,
    );
  });

  it("rejects a non-200 health response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );

    await expect(assertWorkerReachable("https://bridge.example")).rejects.toThrow(
      /500/,
    );
  });
});

describe("route configuration", () => {
  const toml = `[vars]\nBRIDGE_ENABLED = "false"\nROUTES = "{}"\n`;

  it("adds a mapping without dropping existing routes", () => {
    expect(mergeRoutes({ q1: "wf1" }, "q2", "wf2")).toEqual({
      q1: "wf1",
      q2: "wf2",
    });
  });

  it("overwrites a recreated plan's mapping", () => {
    expect(mergeRoutes({ q1: "wf1" }, "q1", "wf9")).toEqual({ q1: "wf9" });
  });

  it("round-trips escaped JSON through wrangler TOML", () => {
    const next = updateWranglerVars(toml, { q1: "wf1", q2: "wf2" });
    expect(next).toContain('BRIDGE_ENABLED = "true"');
    expect(parseRoutesFromToml(next)).toEqual({ q1: "wf1", q2: "wf2" });
  });

  it("is safe to render the same enabled route set twice", () => {
    const once = updateWranglerVars(toml, { q1: "wf1" });
    expect(updateWranglerVars(once, { q1: "wf1" })).toBe(once);
  });

  it("can clear routes and restore the kill switch", () => {
    const enabled = updateWranglerVars(toml, { q1: "wf1" });
    const disabled = updateWranglerVars(enabled, {}, false);
    expect(disabled).toContain('BRIDGE_ENABLED = "false"');
    expect(parseRoutesFromToml(disabled)).toEqual({});
  });
});

describe("extractCreatedQueryId", () => {
  it("accepts the direct Elfa response shape", () => {
    expect(extractCreatedQueryId({ id: "q1" })).toBe("q1");
  });

  it("accepts nested response shapes without guessing an empty id", () => {
    expect(extractCreatedQueryId({ data: { id: "q2" } })).toBe("q2");
    expect(() => extractCreatedQueryId({ ok: true })).toThrow(/query id/i);
  });
});
