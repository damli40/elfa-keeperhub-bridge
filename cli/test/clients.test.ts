import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFundingQuery,
  buildPriceQuery,
  elfaValidate,
} from "../src/elfa";
import { khLastExecution, khUpdateWorkflow } from "../src/keeperhub";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("buildFundingQuery", () => {
  const query = buildFundingQuery("https://bridge.example/elfa", "s".repeat(64));

  it("watches Binance BTC funding for a downward cross of zero", () => {
    expect(query.conditions.AND[0]).toMatchObject({
      source: "funding",
      method: "annualized_rate",
      args: { ticker: "BTC:BINANCE" },
      operator: "crosses_below",
      value: 0,
    });
  });

  it("uses the 24-hour cooldown and three-trigger limit", () => {
    expect(query.repeat).toEqual({ cooldown: "24h", maxTriggers: 3 });
  });

  it("uses one webhook action with the supplied URL and signing secret", () => {
    expect(query.actions).toHaveLength(1);
    expect(query.actions[0]).toMatchObject({
      type: "webhook",
      params: {
        url: "https://bridge.example/elfa",
        signingSecret: "s".repeat(64),
        allNotifications: false,
      },
    });
  });

  it("carries a title and description", () => {
    expect(query.title.length).toBeGreaterThan(0);
    expect(query.description.length).toBeGreaterThan(0);
  });

  it("does not send lifecycle notifications to the execution webhook", () => {
    expect(query.actions[0].params.allNotifications).toBe(false);
  });
});

describe("buildPriceQuery", () => {
  const query = buildPriceQuery(
    "https://bridge.example/elfa",
    "s".repeat(64),
    "BTC",
    65_000,
  );

  it("names the Hyperliquid exchange", () => {
    expect(query.conditions.AND[0].args).toMatchObject({
      symbol: "BTC",
      exchange: "hyperliquid",
    });
  });

  it("expires within one hour and does not repeat", () => {
    expect(query.expiresIn).toBe("1h");
    expect(query).not.toHaveProperty("repeat");
  });

  it("crosses upward through the supplied threshold", () => {
    expect(query.conditions.AND[0]).toMatchObject({
      operator: "crosses_above",
      value: 65_000,
    });
  });

  it("does not send expiry or run-failed notifications to the execution webhook", () => {
    expect(query.actions[0].params.allNotifications).toBe(false);
  });
});

describe("Elfa client", () => {
  it("returns structured validation errors from a 422 response", async () => {
    vi.stubEnv("ELFA_API_KEY", "elfa-test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ valid: false, errors: ["bad query"] }, { status: 422 }),
    );

    await expect(elfaValidate(buildFundingQuery("https://bridge.example/elfa", "s".repeat(64))))
      .resolves.toEqual({ valid: false, errors: ["bad query"] });
  });
});

describe("KeeperHub client", () => {
  it("updates the stored workflow through its canonical endpoint", async () => {
    vi.stubEnv("KEEPERHUB_API_KEY", "kh_test");
    vi.stubEnv("KEEPERHUB_BASE", "https://keeper.example");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id: "wf-1" }),
    );

    await khUpdateWorkflow("wf-1", { name: "Bridge" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://keeper.example/api/workflows/wf-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("reads the newest execution from the workflow-scoped endpoint", async () => {
    vi.stubEnv("KEEPERHUB_API_KEY", "kh_test");
    vi.stubEnv("KEEPERHUB_BASE", "https://keeper.example");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([{ id: "latest" }, { id: "older" }]),
    );

    await expect(khLastExecution("wf-1")).resolves.toEqual({ id: "latest" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://keeper.example/api/workflows/wf-1/executions",
      expect.any(Object),
    );
  });
});
