export interface Env {
  BRIDGE: KVNamespace;
  ELFA_SIGNING_SECRET: string;
  KEEPERHUB_WEBHOOK_KEY: string;
  KEEPERHUB_BASE: string;
  BRIDGE_ENABLED: string;
  ROUTES: string;
}

export const VERSION = "0.1.0";

export function parseRoutes(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({
        ok: true,
        enabled: env.BRIDGE_ENABLED === "true",
        routes: Object.keys(parseRoutes(env.ROUTES)).length,
        version: VERSION,
      });
    }

    return new Response("not found", { status: 404 });
  },
};
