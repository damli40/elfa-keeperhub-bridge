declare namespace Cloudflare {
  interface Env {
    BRIDGE: KVNamespace;
    ELFA_SIGNING_SECRET: string;
    KEEPERHUB_WEBHOOK_KEY: string;
    KEEPERHUB_BASE: string;
    BRIDGE_ENABLED: string;
    ROUTES: string;
  }
}
