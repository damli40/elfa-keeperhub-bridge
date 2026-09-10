import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("GET /health", () => {
  it("reports ok, the kill-switch state and the route count", async () => {
    const req = new Request("https://bridge.test/health");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      enabled: env.BRIDGE_ENABLED === "true",
      routes: Object.keys(JSON.parse(env.ROUTES)).length,
      version: "1.0.1",
    });
  });

  it("404s an unknown path", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://bridge.test/nope"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
