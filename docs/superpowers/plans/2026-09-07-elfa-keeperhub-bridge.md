# Elfa → KeeperHub Execution Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an Elfa Auto market condition fire a signed webhook that a Cloudflare Worker authenticates and de-duplicates, which then drives a KeeperHub workflow that swaps a fixed 0.002 ETH into USDC on Base mainnet.

**Architecture:** Three independently testable pieces. Elfa decides *when* (a hosted condition engine we do not own). A Cloudflare Worker proves *who sent it* (HMAC signature), refuses replays and repeats, and forwards a payload that carries no amounts. A KeeperHub workflow decides *how* — balance check, quote, slippage floor, swap — with all money values hard-coded in the workflow, never in the message.

**Tech Stack:** TypeScript. Cloudflare Workers + KV (Worker). Vitest with `@cloudflare/vitest-pool-workers` (tests). Node 20 + tsx (CLI). KeeperHub MCP tools (workflow authoring). Elfa REST API v2 (plan lifecycle).

**Spec:** `docs/superpowers/specs/2026-09-06-elfa-keeperhub-bridge-design.md` (rev 2)

## Global Constraints

- **Money values live only in the KeeperHub workflow.** No field of the forwarded payload may be read by any numeric, address, token or chain input. Asserted by a test.
- **`amountIn` is raw wei; `ethValue` is human ETH.** For 0.002 ETH: `amountIn = "2000000000000000"`, `ethValue = "0.002"`. They must describe the same amount.
- **Uniswap read outputs sit under `result`**: `{{@quote-1:Quote.result.amountOut}}`, a 6-decimal USDC integer string. Not `Quote.amountOut`.
- **`web3/check-balance` returns `balance` as a human ETH decimal string** (and `balanceWei` separately). Compare with `>=`, never `===`.
- **Telegram nodes require `integrationId` AND `chatId`**, and `parseMode` must be `"none"`.
- **KeeperHub webhook URL is `{base}/api/workflows/{workflowId}/webhook`** with `Authorization: Bearer wfb_…`.
- **Forwarded body must be byte-identical for a given event id** — KeeperHub rejects a reused `Idempotency-Key` with a changed payload. No timestamps in the body.
- **Signature verification runs before anything else, and a failed-signature request performs zero KV writes.** Cloudflare KV free tier allows 1,000 writes/day.
- **Base mainnet chain id is 8453; Base Sepolia is 84532.** Uniswap V3 is registered on 8453 only.
- **Daily spending cap is 0.0055 ETH** (`effectiveDailyCapWei = 5500000000000000`). At most two 0.002 ETH runs per day.
- **Elfa resolves the webhook host in DNS at plan-creation time.** The Worker must be deployed before any Elfa plan is created.
- **Wallet integration id:** `v0dqh167ypmjqxyds6tuh` → `0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`.
- **Token addresses on Base:** WETH `0x4200000000000000000000000000000000000006`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, fee tier `"500"`.
- Nothing named `guardian-*` appears in any workflow, integration, or on-camera surface.

---

## File Structure

| File | Responsibility |
|---|---|
| `wrangler.toml` | Worker config, KV binding, vars |
| `package.json`, `tsconfig.json`, `vitest.config.ts` | toolchain |
| `worker/src/verify.ts` | header parsing, HMAC verification, freshness window — pure functions |
| `worker/src/store.ts` | KV access: dedupe marks, decision records as metadata, raw-body capture |
| `worker/src/forward.ts` | payload construction and sanitising, KeeperHub POST, response classification |
| `worker/src/index.ts` | the pipeline, routing, `/audit`, `/health` |
| `worker/test/*.test.ts` | one test file per module |
| `workflow/keeperhub-workflow.base.json` | mainnet workflow definition |
| `workflow/keeperhub-workflow.sepolia.json` | testnet variant |
| `workflow/workflow.test.ts` | invariants over the JSON |
| `cli/src/elfa.ts` | Elfa API client (validate, create, get, cancel) |
| `cli/src/keeperhub.ts` | KeeperHub REST client (create/update workflow, executions) |
| `cli/src/{setup,fire,status,teardown}.ts` | the four commands |
| `cli/src/index.ts` | argument dispatch |
| `README.md` | problem first, then what it is, then how to run it |
| `video/STORYBOARD.md` | shot list with a fact-provenance table |

---

### Task 1: Repo scaffold and a deployed `/health`

Deploying first is deliberate: Elfa refuses to create a plan against a host that does not resolve in DNS, so the Worker needs to exist on the internet long before the plan does.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.toml`, `.env.example`, `.gitignore`
- Create: `worker/src/index.ts`
- Test: `worker/test/health.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Env` interface with `BRIDGE: KVNamespace`, `ELFA_SIGNING_SECRET: string`, `KEEPERHUB_WEBHOOK_KEY: string`, `KEEPERHUB_BASE: string`, `BRIDGE_ENABLED: string`, `ROUTES: string`; a deployed `https://<name>.<subdomain>.workers.dev` URL

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "elfa-keeperhub-bridge",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "deploy": "wrangler deploy",
    "bridge": "tsx cli/src/index.ts"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250906.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["worker/**/*.ts", "cli/**/*.ts", "workflow/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 4: Create the KV namespace and `wrangler.toml`**

Run: `npx wrangler kv namespace create BRIDGE`

Copy the printed `id` into this file:

```toml
name = "elfa-keeperhub-bridge"
main = "worker/src/index.ts"
compatibility_date = "2026-09-01"

[vars]
KEEPERHUB_BASE = "https://app.keeperhub.com"
BRIDGE_ENABLED = "false"
ROUTES = "{}"

[[kv_namespaces]]
binding = "BRIDGE"
id = "PASTE_THE_ID_FROM_THE_COMMAND_ABOVE"
```

`BRIDGE_ENABLED` starts as `"false"` so a half-built Worker can never forward anything.

- [ ] **Step 5: Create `.gitignore` and `.env.example`**

`.gitignore`:
```
node_modules/
.env
.wrangler/
dist/
```

`.env.example`:
```
ELFA_API_KEY=
ELFA_SIGNING_SECRET=
KEEPERHUB_API_KEY=
KEEPERHUB_WEBHOOK_KEY=
KEEPERHUB_BASE=https://app.keeperhub.com
WORKER_URL=
TELEGRAM_INTEGRATION_ID=
TELEGRAM_CHAT_ID=
WALLET_INTEGRATION_ID=v0dqh167ypmjqxyds6tuh
WALLET_ADDRESS=0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98
```

- [ ] **Step 6: Write the failing test**

Create `worker/test/health.test.ts`:

```typescript
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
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, enabled: false, routes: 0 });
  });

  it("404s an unknown path", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://bridge.test/nope"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run worker/test/health.test.ts`
Expected: FAIL — `worker/src/index.ts` does not exist.

- [ ] **Step 8: Write the minimal implementation**

Create `worker/src/index.ts`:

```typescript
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
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run worker/test/health.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 10: Deploy and confirm the host resolves**

Run:
```bash
npx wrangler deploy
curl -s https://elfa-keeperhub-bridge.<your-subdomain>.workers.dev/health
```
Expected: the same JSON. Record the URL as `WORKER_URL` in `.env`.

Then confirm Elfa will accept it (free, creates nothing):
```bash
curl -sS -X POST -H "x-elfa-api-key: $ELFA_API_KEY" -H "Content-Type: application/json" \
  https://api.elfa.ai/v2/auto/queries/validate \
  -d "{\"query\":{\"title\":\"probe\",\"description\":\"validate only\",\"conditions\":{\"AND\":[{\"source\":\"funding\",\"method\":\"annualized_rate\",\"args\":{\"ticker\":\"BTC:BINANCE\"},\"operator\":\"crosses_below\",\"value\":0}]},\"actions\":[{\"stepId\":\"step_1\",\"type\":\"webhook\",\"params\":{\"url\":\"$WORKER_URL/elfa\",\"signingSecret\":\"$(openssl rand -hex 32)\"}}],\"expiresIn\":\"168h\"}}"
```
Expected: `"valid": true`. If it returns `Webhook URL host could not be resolved`, the deploy has not propagated — wait and retry.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: worker scaffold with /health, deployed so the host resolves"
```

---

### Task 2: Signature verification

**Files:**
- Create: `worker/src/verify.ts`
- Test: `worker/test/verify.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `readHeaders(h: Headers): SignedHeaders | null`, `verifySignature(secret: string, parts: SignedParts): Promise<boolean>`, `isFresh(timestamp: string, nowSec: number, windowSec?: number): boolean`, and `interface SignedHeaders { eventId: string; timestamp: string; signature: string }`

- [ ] **Step 1: Write the failing test**

Create `worker/test/verify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readHeaders, verifySignature, isFresh } from "../src/verify";

const SECRET = "a".repeat(64);

async function sign(secret: string, timestamp: string, eventId: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${eventId}.${rawBody}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("readHeaders", () => {
  it("returns the three Elfa headers", () => {
    const h = new Headers({
      "X-Auto-Event-Id": "42",
      "X-Auto-Signature-Timestamp": "1775035200",
      "X-Auto-Signature": "v1=deadbeef",
    });
    expect(readHeaders(h)).toEqual({ eventId: "42", timestamp: "1775035200", signature: "v1=deadbeef" });
  });

  it("returns null when any header is missing", () => {
    const h = new Headers({ "X-Auto-Event-Id": "42", "X-Auto-Signature": "v1=deadbeef" });
    expect(readHeaders(h)).toBeNull();
  });
});

describe("verifySignature", () => {
  const parts = { eventId: "42", timestamp: "1775035200", rawBody: '{"id":42}' };

  it("accepts a correct signature", async () => {
    const hex = await sign(SECRET, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: `v1=${hex}` })).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    const hex = await sign("b".repeat(64), parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: `v1=${hex}` })).toBe(false);
  });

  it("rejects when the body was tampered with after signing", async () => {
    const hex = await sign(SECRET, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, rawBody: '{"id":43}', signature: `v1=${hex}` })).toBe(false);
  });

  it("rejects a missing v1= prefix", async () => {
    const hex = await sign(SECRET, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: hex })).toBe(false);
  });

  it("rejects a malformed hex payload", async () => {
    expect(await verifySignature(SECRET, { ...parts, signature: "v1=zzzz" })).toBe(false);
  });

  it("does NOT accept a signature made with a pre-hashed secret", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET));
    const hashedSecret = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hex = await sign(hashedSecret, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: `v1=${hex}` })).toBe(false);
  });
});

describe("isFresh", () => {
  const now = 1775035200;
  it("accepts a timestamp inside the window", () => {
    expect(isFresh(String(now - 29), now)).toBe(true);
    expect(isFresh(String(now + 29), now)).toBe(true);
  });
  it("rejects a timestamp outside the window in either direction", () => {
    expect(isFresh(String(now - 31), now)).toBe(false);
    expect(isFresh(String(now + 31), now)).toBe(false);
  });
  it("rejects a non-numeric timestamp", () => {
    expect(isFresh("not-a-number", now)).toBe(false);
  });
});
```

The pre-hashed-secret test is there on purpose: Elfa's docs warn that an earlier revision documented `HMAC(SHA256(secret), …)` and that it is wrong for explicit signing secrets.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/test/verify.test.ts`
Expected: FAIL — cannot resolve `../src/verify`.

- [ ] **Step 3: Write the implementation**

Create `worker/src/verify.ts`:

```typescript
export interface SignedHeaders {
  eventId: string;
  timestamp: string;
  signature: string;
}

export interface SignedParts extends SignedHeaders {
  rawBody: string;
}

export function readHeaders(h: Headers): SignedHeaders | null {
  const eventId = h.get("X-Auto-Event-Id");
  const timestamp = h.get("X-Auto-Signature-Timestamp");
  const signature = h.get("X-Auto-Signature");
  if (!eventId || !timestamp || !signature) return null;
  return { eventId, timestamp, signature };
}

function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(secret: string, parts: SignedParts): Promise<boolean> {
  if (!parts.signature.startsWith("v1=")) return false;
  const given = parts.signature.slice(3).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${parts.timestamp}.${parts.eventId}.${parts.rawBody}`),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return equalsConstantTime(given, expected);
}

export function isFresh(timestamp: string, nowSec: number, windowSec = 30): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSec - ts) <= windowSec;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/test/verify.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/verify.ts worker/test/verify.test.ts
git commit -m "feat: HMAC signature verification with constant-time compare"
```

---

### Task 3: KV storage

Decision records are stored in KV **metadata** under a reverse-timestamp key, so `/audit` reads 200 records with one `list()` call instead of 201 reads, and nothing ever does a read-modify-write (KV has no atomic update, so a shared index key would silently lose entries under concurrency).

**Files:**
- Create: `worker/src/store.ts`
- Test: `worker/test/store.test.ts`

**Interfaces:**
- Consumes: `Env` from `worker/src/index.ts`
- Produces: `interface Decision`, `decisionKey(eventId, atMs)`, `seenBefore(kv, eventId)`, `markSeen(kv, eventId)`, `recordDecision(kv, d)`, `recentDecisions(kv, limit?)`, `storeRaw(kv, eventId, body)`

- [ ] **Step 1: Write the failing test**

Create `worker/test/store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/test/store.test.ts`
Expected: FAIL — cannot resolve `../src/store`.

- [ ] **Step 3: Write the implementation**

Create `worker/src/store.ts`:

```typescript
export interface Decision {
  at: string;
  eventId: string;
  queryId: string | null;
  decision: string;
  detail?: Record<string, unknown>;
  latencyMs?: number;
}

const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DECISION_TTL_SECONDS = 30 * 24 * 60 * 60;
const RAW_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Wider than any millisecond timestamp this century, so the difference never goes negative. */
const REVERSE_BASE = 9_999_999_999_999;

export function decisionKey(eventId: string, atMs: number): string {
  const reverse = String(REVERSE_BASE - atMs).padStart(13, "0");
  return `decision:${reverse}:${eventId}`;
}

export async function seenBefore(kv: KVNamespace, eventId: string): Promise<boolean> {
  return (await kv.get(`seen:${eventId}`)) !== null;
}

export async function markSeen(kv: KVNamespace, eventId: string): Promise<void> {
  await kv.put(`seen:${eventId}`, "1", { expirationTtl: SEEN_TTL_SECONDS });
}

export async function recordDecision(kv: KVNamespace, d: Decision): Promise<void> {
  await kv.put(decisionKey(d.eventId, Date.parse(d.at)), "", {
    metadata: d,
    expirationTtl: DECISION_TTL_SECONDS,
  });
}

export async function recentDecisions(kv: KVNamespace, limit = 200): Promise<Decision[]> {
  const listed = await kv.list<Decision>({ prefix: "decision:", limit });
  return listed.keys.map((k) => k.metadata).filter((m): m is Decision => Boolean(m));
}

export async function storeRaw(kv: KVNamespace, eventId: string, body: string): Promise<void> {
  await kv.put(`raw:${eventId}`, body, { expirationTtl: RAW_TTL_SECONDS });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/test/store.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/store.ts worker/test/store.test.ts
git commit -m "feat: KV store with metadata-listed decision records"
```

---

### Task 4: Payload building and KeeperHub forwarding

**Files:**
- Create: `worker/src/forward.ts`
- Test: `worker/test/forward.test.ts`

**Interfaces:**
- Consumes: `Env` from `worker/src/index.ts`
- Produces: `interface ForwardPayload`, `sanitize(value, max?)`, `extractContext(body)`, `buildPayload(eventId, queryId, body)`, `classify(status)`, `RETRY_DELAYS_MS`, `postOnce(env, workflowId, payload)`, `interface PostResult`

- [ ] **Step 1: Write the failing test**

Create `worker/test/forward.test.ts`:

```typescript
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

  it("has no timestamp field", () => {
    expect(Object.keys(buildPayload("42", "q1", {}))).not.toContain("receivedAt");
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
    expect(result).toMatchObject({ status: 200, executionId: "x1" });
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/test/forward.test.ts`
Expected: FAIL — cannot resolve `../src/forward`.

- [ ] **Step 3: Write the implementation**

Create `worker/src/forward.ts`:

```typescript
import type { Env } from "./index";

export interface ForwardPayload {
  source: "elfa-auto";
  eventId: string;
  queryId: string;
  title: string;
  body: string;
  observedValue: string | null;
  triggerTime: string | null;
}

export interface PostResult {
  status: number | null;
  body: string;
  executionId?: string;
}

export const RETRY_DELAYS_MS = [2000, 10000, 30000];

const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 410]);

export function sanitize(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.replaceAll("{{", "").replaceAll("}}", "").slice(0, max);
}

export function extractContext(body: unknown): { observedValue: string | null; triggerTime: string | null } {
  const trigger = (body as { trigger?: unknown })?.trigger as
    | { time?: unknown; matchedConditions?: Array<{ match?: { observedValue?: unknown } }> }
    | undefined;

  const observed = trigger?.matchedConditions?.[0]?.match?.observedValue;
  return {
    observedValue: observed === undefined || observed === null ? null : String(observed),
    triggerTime: typeof trigger?.time === "string" ? trigger.time : null,
  };
}

export function buildPayload(eventId: string, queryId: string, body: unknown): ForwardPayload {
  const { observedValue, triggerTime } = extractContext(body);
  const source = body as { title?: unknown; body?: unknown };
  return {
    source: "elfa-auto",
    eventId,
    queryId,
    title: sanitize(source?.title),
    body: sanitize(source?.body),
    observedValue,
    triggerTime,
  };
}

export function classify(status: number | null): "ok" | "permanent" | "transient" {
  if (status === null) return "transient";
  if (status >= 200 && status < 300) return "ok";
  if (PERMANENT_STATUSES.has(status)) return "permanent";
  return "transient";
}

export async function postOnce(env: Env, workflowId: string, payload: ForwardPayload): Promise<PostResult> {
  try {
    const res = await fetch(`${env.KEEPERHUB_BASE}/api/workflows/${workflowId}/webhook`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.KEEPERHUB_WEBHOOK_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `elfa-${payload.eventId}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let executionId: string | undefined;
    try {
      executionId = (JSON.parse(text) as { executionId?: string }).executionId;
    } catch {
      // KeeperHub returned something that is not JSON; the raw text is kept in body.
    }
    return { status: res.status, body: text.slice(0, 500), executionId };
  } catch (error) {
    return { status: null, body: String(error).slice(0, 500) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/test/forward.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/forward.ts worker/test/forward.test.ts
git commit -m "feat: deterministic payload building and KeeperHub forwarding"
```

---

### Task 5: The pipeline, `/audit`, and redeploy

Check order matters and is asserted: signature before freshness, and **no KV write at all** for a request that fails the signature. On the free tier 1,000 writes a day is the whole budget; persisting unsigned junk would exhaust it and disarm the dedupe guard.

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/test/pipeline.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4
- Produces: the finished Worker: `POST /elfa`, `GET /audit`, `GET /health`

- [ ] **Step 1: Write the failing test**

Create `worker/test/pipeline.test.ts`:

```typescript
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
});

describe("GET /audit", () => {
  beforeEach(wipe);
  it("renders HTML when asked", async () => {
    const res = await call(new Request("https://bridge.test/audit?format=html"));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<table");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/test/pipeline.test.ts`
Expected: FAIL — `/elfa` returns 404.

- [ ] **Step 3: Write the implementation**

Replace `worker/src/index.ts` with:

```typescript
import { readHeaders, verifySignature, isFresh } from "./verify";
import { markSeen, recentDecisions, recordDecision, seenBefore, storeRaw, type Decision } from "./store";
import { buildPayload, classify, postOnce, RETRY_DELAYS_MS, type ForwardPayload } from "./forward";

export interface Env {
  BRIDGE: KVNamespace;
  ELFA_SIGNING_SECRET: string;
  KEEPERHUB_WEBHOOK_KEY: string;
  KEEPERHUB_BASE: string;
  BRIDGE_ENABLED: string;
  ROUTES: string;
}

export const VERSION = "1.0.0";

/** Requests rejected before any storage, counted in memory only so unsigned traffic costs no KV writes. */
let rejectedUnsigned = 0;

export function parseRoutes(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderAudit(decisions: Decision[]): string {
  const rows = decisions
    .map(
      (d) =>
        `<tr><td>${escapeHtml(d.at)}</td><td>${escapeHtml(d.eventId)}</td><td>${escapeHtml(d.queryId)}</td>` +
        `<td>${escapeHtml(d.decision)}</td><td><code>${escapeHtml(JSON.stringify(d.detail ?? {}))}</code></td></tr>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Elfa → KeeperHub bridge audit</title>
<style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #ddd;padding:.4rem .6rem;text-align:left;vertical-align:top}
code{font-size:12px;word-break:break-all}</style>
<h1>Bridge decisions</h1><p>Newest first. Every delivery Elfa sent, and what the bridge did with it.</p>
<table><thead><tr><th>at</th><th>event</th><th>query</th><th>decision</th><th>detail</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function forwardWithRetry(env: Env, ctx: ExecutionContext, workflowId: string, payload: ForwardPayload, base: Decision): Promise<Decision> {
  const first = await postOnce(env, workflowId, payload);
  const verdict = classify(first.status);

  if (verdict === "ok") {
    return { ...base, decision: "forwarded:ok", detail: { workflowId, executionId: first.executionId ?? null } };
  }
  if (verdict === "permanent") {
    return { ...base, decision: "forwarded:permanent_error", detail: { workflowId, status: first.status, body: first.body } };
  }

  // Transient: keep trying in the background. Elfa already has its 200, and the
  // idempotency key means a late success cannot execute twice.
  ctx.waitUntil(
    (async () => {
      for (const delay of RETRY_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const retry = await postOnce(env, workflowId, payload);
        if (classify(retry.status) === "ok") {
          await recordDecision(env.BRIDGE, {
            ...base,
            at: new Date().toISOString(),
            decision: "forwarded:ok_after_retry",
            detail: { workflowId, executionId: retry.executionId ?? null },
          });
          return;
        }
        if (classify(retry.status) === "permanent") {
          await recordDecision(env.BRIDGE, {
            ...base,
            at: new Date().toISOString(),
            decision: "forwarded:permanent_error",
            detail: { workflowId, status: retry.status, body: retry.body },
          });
          return;
        }
      }
      await recordDecision(env.BRIDGE, {
        ...base,
        at: new Date().toISOString(),
        decision: "forwarded:gave_up",
        detail: { workflowId },
      });
    })(),
  );

  return { ...base, decision: "forwarded:retrying", detail: { workflowId, status: first.status, body: first.body } };
}

async function handleElfa(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const startedAt = Date.now();

  const headers = readHeaders(request.headers);
  if (!headers) {
    rejectedUnsigned++;
    return new Response("missing signature headers", { status: 400 });
  }

  const rawBody = await request.text();

  // Signature first: everything below this line costs KV writes.
  if (!(await verifySignature(env.ELFA_SIGNING_SECRET, { ...headers, rawBody }))) {
    rejectedUnsigned++;
    return new Response("bad signature", { status: 401 });
  }

  const base: Decision = { at: new Date().toISOString(), eventId: headers.eventId, queryId: null, decision: "" };
  const finish = async (decision: Decision, status: number): Promise<Response> => {
    await recordDecision(env.BRIDGE, { ...decision, latencyMs: Date.now() - startedAt });
    return new Response(decision.decision, { status });
  };

  if (!isFresh(headers.timestamp, Math.floor(Date.now() / 1000))) {
    return finish({ ...base, decision: "refused:stale" }, 401);
  }

  if (env.BRIDGE_ENABLED !== "true") {
    return finish({ ...base, decision: "dropped:kill_switch" }, 200);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return finish({ ...base, decision: "refused:bad_json" }, 200);
  }

  const queryId = (parsed as { data?: { queryId?: string } })?.data?.queryId ?? null;
  const workflowId = queryId ? parseRoutes(env.ROUTES)[queryId] : undefined;
  if (!queryId || !workflowId) {
    return finish({ ...base, queryId, decision: "dropped:unrouted" }, 200);
  }

  if (await seenBefore(env.BRIDGE, headers.eventId)) {
    return finish({ ...base, queryId, decision: "dropped:duplicate" }, 200);
  }
  await markSeen(env.BRIDGE, headers.eventId);
  await storeRaw(env.BRIDGE, headers.eventId, rawBody);

  const payload = buildPayload(headers.eventId, queryId, parsed);
  const outcome = await forwardWithRetry(env, ctx, workflowId, payload, { ...base, queryId });
  return finish(outcome, 200);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/elfa" && request.method === "POST") {
      return handleElfa(request, env, ctx);
    }

    if (url.pathname === "/audit" && request.method === "GET") {
      const decisions = await recentDecisions(env.BRIDGE, 200);
      if (url.searchParams.get("format") === "html") {
        return new Response(renderAudit(decisions), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return Response.json(decisions);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({
        ok: true,
        enabled: env.BRIDGE_ENABLED === "true",
        routes: Object.keys(parseRoutes(env.ROUTES)).length,
        version: VERSION,
        rejectedUnsigned,
      });
    }

    return new Response("not found", { status: 404 });
  },
};
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — all four test files. Fix `worker/test/health.test.ts` if the version assertion drifts.

- [ ] **Step 5: Set secrets and redeploy**

```bash
openssl rand -hex 32   # save this as ELFA_SIGNING_SECRET in .env too
npx wrangler secret put ELFA_SIGNING_SECRET
npx wrangler secret put KEEPERHUB_WEBHOOK_KEY   # the wfb_… key from KeeperHub Settings › Developer › API keys
npx wrangler deploy
curl -s "$WORKER_URL/health"
```
Expected: `{"ok":true,"enabled":false,...}` — still disabled, which is correct until a route exists.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: signed-webhook pipeline with dedupe, retry and public audit log"
```

---

### Task 6: Workflow definitions and their invariants

The tests here are the guard against the exact class of bug the review found: values that are locally plausible, run fine, and move the wrong amount.

**Files:**
- Create: `workflow/keeperhub-workflow.base.json`
- Create: `workflow/keeperhub-workflow.sepolia.json`
- Test: `workflow/workflow.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: two workflow definitions loadable by `cli/src/keeperhub.ts` in Task 8

- [ ] **Step 1: Write `workflow/keeperhub-workflow.base.json`**

Replace `TELEGRAM_INTEGRATION_ID` and `TELEGRAM_CHAT_ID` with the real values before creating the workflow.

```json
{
  "name": "Elfa Auto → de-risk ETH to USDC (Base)",
  "nodes": [
    {
      "id": "trigger-1",
      "type": "trigger",
      "data": {
        "label": "Trigger",
        "type": "trigger",
        "config": {
          "triggerType": "Webhook",
          "webhookMockRequest": "{\"source\":\"elfa-auto\",\"eventId\":\"mock-1\",\"queryId\":\"mock-query\",\"title\":\"BTC funding flips negative (Binance)\",\"body\":\"annualized_rate crossed below 0\",\"observedValue\":null,\"triggerTime\":null}"
        }
      }
    },
    {
      "id": "bal-1",
      "type": "action",
      "data": {
        "label": "Check Balance",
        "type": "action",
        "config": {
          "actionType": "web3/check-balance",
          "chainId": 8453,
          "address": "0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98"
        }
      }
    },
    {
      "id": "cond-bal",
      "type": "action",
      "data": {
        "label": "Balance covers amount plus gas reserve",
        "type": "action",
        "config": {
          "actionType": "Condition",
          "condition": "{{@bal-1:Check Balance.balance}} >= 0.0025"
        }
      }
    },
    {
      "id": "quote-1",
      "type": "action",
      "data": {
        "label": "Quote",
        "type": "action",
        "config": {
          "actionType": "uniswap/quote-exact-input",
          "network": "8453",
          "tokenIn": "0x4200000000000000000000000000000000000006",
          "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "amountIn": "2000000000000000",
          "fee": "500"
        }
      }
    },
    {
      "id": "cond-quote",
      "type": "action",
      "data": {
        "label": "Quote at or above the floor",
        "type": "action",
        "config": {
          "actionType": "Condition",
          "condition": "{{@quote-1:Quote.result.amountOut}} >= 4828900"
        }
      }
    },
    {
      "id": "swap-1",
      "type": "action",
      "data": {
        "label": "Swap",
        "type": "action",
        "config": {
          "actionType": "uniswap/swap-exact-input",
          "network": "8453",
          "integrationId": "v0dqh167ypmjqxyds6tuh",
          "tokenIn": "0x4200000000000000000000000000000000000006",
          "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "fee": "500",
          "recipient": "0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98",
          "amountIn": "2000000000000000",
          "amountOutMinimum": "4828900",
          "ethValue": "0.002"
        }
      }
    },
    {
      "id": "tg-ok",
      "type": "action",
      "data": {
        "label": "Notify executed",
        "type": "action",
        "config": {
          "actionType": "telegram/send-message",
          "integrationId": "TELEGRAM_INTEGRATION_ID",
          "chatId": "TELEGRAM_CHAT_ID",
          "parseMode": "none",
          "message": "Executed {{@trigger-1:Trigger.eventId}}: {{@trigger-1:Trigger.title}} — swapped 0.002 ETH for USDC. tx {{@swap-1:Swap.transactionHash}}"
        }
      }
    },
    {
      "id": "tg-skip-bal",
      "type": "action",
      "data": {
        "label": "Notify skipped (balance)",
        "type": "action",
        "config": {
          "actionType": "telegram/send-message",
          "integrationId": "TELEGRAM_INTEGRATION_ID",
          "chatId": "TELEGRAM_CHAT_ID",
          "parseMode": "none",
          "message": "Skipped {{@trigger-1:Trigger.eventId}}: wallet holds {{@bal-1:Check Balance.balance}} ETH, below the 0.0025 floor. No transaction sent."
        }
      }
    },
    {
      "id": "tg-skip-quote",
      "type": "action",
      "data": {
        "label": "Notify skipped (quote)",
        "type": "action",
        "config": {
          "actionType": "telegram/send-message",
          "integrationId": "TELEGRAM_INTEGRATION_ID",
          "chatId": "TELEGRAM_CHAT_ID",
          "parseMode": "none",
          "message": "Skipped {{@trigger-1:Trigger.eventId}}: quote {{@quote-1:Quote.result.amountOut}} is below the 4828900 floor. No transaction sent."
        }
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "trigger-1", "target": "bal-1" },
    { "id": "e2", "source": "bal-1", "target": "cond-bal" },
    { "id": "e3", "source": "cond-bal", "target": "quote-1", "sourceHandle": "true" },
    { "id": "e4", "source": "cond-bal", "target": "tg-skip-bal", "sourceHandle": "false" },
    { "id": "e5", "source": "quote-1", "target": "cond-quote" },
    { "id": "e6", "source": "cond-quote", "target": "swap-1", "sourceHandle": "true" },
    { "id": "e7", "source": "cond-quote", "target": "tg-skip-quote", "sourceHandle": "false" },
    { "id": "e8", "source": "swap-1", "target": "tg-ok" }
  ]
}
```

- [ ] **Step 2: Write `workflow/keeperhub-workflow.sepolia.json`**

No Uniswap on 84532, so there is no quote and no quote floor. The wrap still moves real testnet value and produces a transaction hash.

```json
{
  "name": "Elfa Auto → wrap ETH (Base Sepolia)",
  "nodes": [
    {
      "id": "trigger-1",
      "type": "trigger",
      "data": {
        "label": "Trigger",
        "type": "trigger",
        "config": {
          "triggerType": "Webhook",
          "webhookMockRequest": "{\"source\":\"elfa-auto\",\"eventId\":\"mock-1\",\"queryId\":\"mock-query\",\"title\":\"BTC funding flips negative (Binance)\",\"body\":\"annualized_rate crossed below 0\",\"observedValue\":null,\"triggerTime\":null}"
        }
      }
    },
    {
      "id": "bal-1",
      "type": "action",
      "data": {
        "label": "Check Balance",
        "type": "action",
        "config": {
          "actionType": "web3/check-balance",
          "chainId": 84532,
          "address": "0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98"
        }
      }
    },
    {
      "id": "cond-bal",
      "type": "action",
      "data": {
        "label": "Balance covers amount plus gas reserve",
        "type": "action",
        "config": {
          "actionType": "Condition",
          "condition": "{{@bal-1:Check Balance.balance}} >= 0.0025"
        }
      }
    },
    {
      "id": "wrap-1",
      "type": "action",
      "data": {
        "label": "Wrap",
        "type": "action",
        "config": {
          "actionType": "wrapped/wrap",
          "network": "84532",
          "integrationId": "v0dqh167ypmjqxyds6tuh",
          "ethValue": "0.002"
        }
      }
    },
    {
      "id": "tg-ok",
      "type": "action",
      "data": {
        "label": "Notify executed",
        "type": "action",
        "config": {
          "actionType": "telegram/send-message",
          "integrationId": "TELEGRAM_INTEGRATION_ID",
          "chatId": "TELEGRAM_CHAT_ID",
          "parseMode": "none",
          "message": "Executed {{@trigger-1:Trigger.eventId}} on Base Sepolia: wrapped 0.002 ETH. tx {{@wrap-1:Wrap.transactionHash}}"
        }
      }
    },
    {
      "id": "tg-skip-bal",
      "type": "action",
      "data": {
        "label": "Notify skipped (balance)",
        "type": "action",
        "config": {
          "actionType": "telegram/send-message",
          "integrationId": "TELEGRAM_INTEGRATION_ID",
          "chatId": "TELEGRAM_CHAT_ID",
          "parseMode": "none",
          "message": "Skipped {{@trigger-1:Trigger.eventId}}: wallet holds {{@bal-1:Check Balance.balance}} ETH, below the 0.0025 floor. No transaction sent."
        }
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "trigger-1", "target": "bal-1" },
    { "id": "e2", "source": "bal-1", "target": "cond-bal" },
    { "id": "e3", "source": "cond-bal", "target": "wrap-1", "sourceHandle": "true" },
    { "id": "e4", "source": "cond-bal", "target": "tg-skip-bal", "sourceHandle": "false" },
    { "id": "e5", "source": "wrap-1", "target": "tg-ok" }
  ]
}
```

- [ ] **Step 3: Write the failing invariant test**

Create `workflow/workflow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import base from "./keeperhub-workflow.base.json";
import sepolia from "./keeperhub-workflow.sepolia.json";

interface Node {
  id: string;
  data: { label: string; config: Record<string, unknown> };
}
interface Workflow {
  name: string;
  nodes: Node[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
}

const workflows: Array<[string, Workflow]> = [
  ["base", base as Workflow],
  ["sepolia", sepolia as Workflow],
];

/** Fields whose value decides how much moves, where it goes, or on what chain. */
const MONEY_FIELDS = [
  "amountIn", "amountOut", "amountOutMinimum", "amountInMaximum", "ethValue",
  "address", "recipient", "tokenIn", "tokenOut", "fee", "chainId", "network", "integrationId",
];

describe.each(workflows)("%s workflow", (_name, wf) => {
  it("references the trigger only in human-readable message text", () => {
    for (const node of wf.nodes) {
      for (const [field, value] of Object.entries(node.data.config)) {
        if (typeof value !== "string") continue;
        if (!value.includes("trigger-1")) continue;
        expect(MONEY_FIELDS).not.toContain(field);
        expect(field).toBe("message");
      }
    }
  });

  it("gives every Condition edge an explicit branch", () => {
    const conditionIds = wf.nodes.filter((n) => n.data.config.actionType === "Condition").map((n) => n.id);
    for (const edge of wf.edges) {
      if (conditionIds.includes(edge.source)) {
        expect(["true", "false"]).toContain(edge.sourceHandle);
      }
    }
  });

  it("wires both branches of every Condition", () => {
    const conditionIds = wf.nodes.filter((n) => n.data.config.actionType === "Condition").map((n) => n.id);
    for (const id of conditionIds) {
      const handles = wf.edges.filter((e) => e.source === id).map((e) => e.sourceHandle);
      expect(handles).toContain("true");
      expect(handles).toContain("false");
    }
  });

  it("points every edge at a node that exists", () => {
    const ids = new Set(wf.nodes.map((n) => n.id));
    for (const edge of wf.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it("sets parseMode none and both Telegram identifiers on every message node", () => {
    for (const node of wf.nodes) {
      if (node.data.config.actionType !== "telegram/send-message") continue;
      expect(node.data.config.parseMode).toBe("none");
      expect(node.data.config.integrationId).toBeTruthy();
      expect(node.data.config.chatId).toBeTruthy();
    }
  });

  it("uses no name from another project", () => {
    expect(JSON.stringify(wf)).not.toMatch(/guardian/i);
    expect(JSON.stringify(wf)).not.toMatch(/sentinel/i);
  });
});

describe("base workflow money values", () => {
  const wf = base as Workflow;
  const node = (id: string) => wf.nodes.find((n) => n.id === id)!.data.config;

  it("expresses the same amount as wei on amountIn and as ETH on ethValue", () => {
    const swap = node("swap-1");
    const wei = BigInt(swap.amountIn as string);
    const eth = Number(swap.ethValue as string);
    expect(Number(wei) / 1e18).toBeCloseTo(eth, 12);
  });

  it("quotes exactly the amount it swaps", () => {
    expect(node("quote-1").amountIn).toBe(node("swap-1").amountIn);
  });

  it("uses the same slippage floor in the guard and in the swap", () => {
    const guard = node("cond-quote").condition as string;
    const floor = guard.match(/>=\s*(\d+)/)![1];
    expect(node("swap-1").amountOutMinimum).toBe(floor);
  });

  it("reads the quote through the result wrapper, not the bare field", () => {
    expect(node("cond-quote").condition).toContain("Quote.result.amountOut");
  });

  it("compares balance with a numeric operator, never strict equality", () => {
    expect(node("cond-bal").condition).toMatch(/>=/);
    expect(node("cond-bal").condition).not.toContain("===");
  });

  it("swaps WETH for USDC on Base at the 0.05 percent tier", () => {
    const swap = node("swap-1");
    expect(swap.tokenIn).toBe("0x4200000000000000000000000000000000000006");
    expect(swap.tokenOut).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(swap.network).toBe("8453");
    expect(swap.fee).toBe("500");
  });

  it("keeps a single run inside the 0.0055 ETH daily cap", () => {
    expect(BigInt(node("swap-1").amountIn as string)).toBeLessThan(5_500_000_000_000_000n);
  });
});
```

- [ ] **Step 4: Add `resolveJsonModule` and run the test**

Add to `tsconfig.json` under `compilerOptions`: `"resolveJsonModule": true`.

Run: `npx vitest run workflow/workflow.test.ts`
Expected: PASS, 19 tests. If the amount pairing test fails, the wei and ETH values disagree — fix the JSON, never the test.

- [ ] **Step 5: Commit**

```bash
git add workflow tsconfig.json
git commit -m "feat: workflow definitions with money-value invariants"
```

---

### Task 7: Create the workflow and prove the swap by hand

This is the riskiest step in the build and it comes before any CLI code, because it is the only one that spends real money and depends on assumptions no offline test can settle.

**Files:**
- Modify: `workflow/keeperhub-workflow.base.json` (real Telegram ids, refreshed floor)
- Create: `docs/PROOF.md`

**Interfaces:**
- Consumes: `workflow/keeperhub-workflow.base.json`
- Produces: a KeeperHub `workflowId`, a Basescan transaction hash, both recorded in `docs/PROOF.md`

- [ ] **Step 1: Create the Telegram integration**

In the KeeperHub app, create a Telegram integration named `elfa-bridge-telegram` with the bot token. Get the chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending the bot a message. Put both in `.env` as `TELEGRAM_INTEGRATION_ID` and `TELEGRAM_CHAT_ID`, then substitute them into both workflow JSON files.

- [ ] **Step 2: Refresh the quote and set the floor**

Use the KeeperHub MCP tool `execute_protocol_action` with `actionType: "uniswap/quote-exact-input"` and params `{network:"8453", tokenIn:"0x4200000000000000000000000000000000000006", tokenOut:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountIn:"2000000000000000", fee:"500"}`.

Take `result.amountOut`, multiply by 0.97, floor to an integer, and put that number in **both** `cond-quote.condition` and `swap-1.amountOutMinimum`. The invariant test in Task 6 fails if they disagree.

- [ ] **Step 3: Fund the wallet and confirm the cap**

Send about 0.01 ETH on Base to `0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`. Then call the MCP tool `get_spending_limits` and confirm `effectiveDailyCapWei` is at least `2000000000000000`.

- [ ] **Step 4: Create the workflow**

Call the MCP tool `create_workflow` with the contents of `workflow/keeperhub-workflow.base.json`. Then call `validate_workflow` on the returned id.
Expected: valid. Record the `workflowId` in `.env` as `KEEPERHUB_WORKFLOW_ID`.

- [ ] **Step 5: Run it manually and watch every step**

Call `execute_workflow` on that id, then poll `get_execution` until it finishes.

Expected, in order: `bal-1` returns a balance string like `"0.01"`; `cond-bal` true; `quote-1` returns `result.amountOut` near 4978247; `cond-quote` true; `swap-1` returns a `transactionHash` and `transactionLink`; `tg-ok` sends.

If `swap-1` reverts, the fallback is a `wrapped/wrap` node on 8453 — still a real value-moving transaction on mainnet, one node instead of three. Do not spend more than two attempts here.

- [ ] **Step 6: Prove the refusal path**

Temporarily raise the floor in `cond-quote` above the live quote, update the workflow, execute again.
Expected: `cond-quote` false, `tg-skip-quote` sends, no transaction. Restore the real floor afterwards.

- [ ] **Step 7: Record the proof**

Create `docs/PROOF.md` with the workflow id, the Basescan link, the observed quote, the balance before and after, and the skip-branch execution id. This is the evidence the README and the video cite.

- [ ] **Step 8: Commit**

```bash
git add workflow docs/PROOF.md
git commit -m "feat: workflow live on Base, swap and refusal paths both proven"
```

---

### Task 8: API clients

**Files:**
- Create: `cli/src/elfa.ts`
- Create: `cli/src/keeperhub.ts`
- Test: `cli/test/clients.test.ts`

**Interfaces:**
- Consumes: `.env`
- Produces: `elfaValidate(query)`, `elfaCreate(query)`, `elfaGet(queryId)`, `elfaCancel(queryId)`, `elfaList()`, `buildFundingQuery(url, secret)`, `buildPriceQuery(url, secret, symbol, threshold)`, `khUpdateWorkflow(id, definition)`, `khLastExecution(workflowId)`

- [ ] **Step 1: Write the failing test**

Create `cli/test/clients.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildFundingQuery, buildPriceQuery } from "../src/elfa";

describe("buildFundingQuery", () => {
  const q = buildFundingQuery("https://bridge.example/elfa", "s".repeat(64));

  it("watches Binance BTC funding for a downward cross of zero", () => {
    expect(q.conditions.AND[0]).toMatchObject({
      source: "funding",
      method: "annualized_rate",
      args: { ticker: "BTC:BINANCE" },
      operator: "crosses_below",
      value: 0,
    });
  });

  it("repeats with both mandatory fields, capped below the daily spend cap", () => {
    expect(q.repeat).toEqual({ cooldown: "24h", maxTriggers: 3 });
  });

  it("uses exactly one webhook action carrying the signing secret", () => {
    expect(q.actions).toHaveLength(1);
    expect(q.actions[0]).toMatchObject({ type: "webhook", params: { url: "https://bridge.example/elfa" } });
    expect(q.actions[0].params.signingSecret).toHaveLength(64);
  });

  it("carries a title and description, which appear in every notification", () => {
    expect(q.title.length).toBeGreaterThan(0);
    expect(q.description.length).toBeGreaterThan(0);
  });
});

describe("buildPriceQuery", () => {
  const q = buildPriceQuery("https://bridge.example/elfa", "s".repeat(64), "BTC", 65000);

  it("names an exchange, which price conditions require", () => {
    expect(q.conditions.AND[0].args).toMatchObject({ symbol: "BTC", exchange: "hyperliquid" });
  });

  it("expires within the hour and does not repeat", () => {
    expect(q.expiresIn).toBe("1h");
    expect(q).not.toHaveProperty("repeat");
  });

  it("crosses upward through the given threshold", () => {
    expect(q.conditions.AND[0]).toMatchObject({ operator: "crosses_above", value: 65000 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run cli/test/clients.test.ts`
Expected: FAIL — cannot resolve `../src/elfa`.

- [ ] **Step 3: Write `cli/src/elfa.ts`**

```typescript
const BASE = "https://api.elfa.ai/v2";

export interface ElfaCondition {
  source: string;
  method?: string;
  args: Record<string, unknown>;
  operator?: string;
  value?: unknown;
}

export interface ElfaQuery {
  title: string;
  description: string;
  conditions: { AND: ElfaCondition[] };
  actions: Array<{ stepId: string; type: string; params: Record<string, string | boolean> }>;
  expiresIn: string;
  repeat?: { cooldown: string; maxTriggers: number };
}

function key(): string {
  const value = process.env.ELFA_API_KEY;
  if (!value) throw new Error("ELFA_API_KEY is not set");
  return value;
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "x-elfa-api-key": key(), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Elfa ${path} returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok && res.status !== 422) {
    throw new Error(`Elfa ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return parsed;
}

export function buildFundingQuery(webhookUrl: string, signingSecret: string): ElfaQuery {
  return {
    title: "BTC funding flips negative (Binance)",
    description:
      "Shorts now pay longs on Binance BTC perpetuals, a crowded-short signal. De-risk a fixed 0.002 ETH slice into USDC through KeeperHub.",
    conditions: {
      AND: [
        { source: "funding", method: "annualized_rate", args: { ticker: "BTC:BINANCE" }, operator: "crosses_below", value: 0 },
      ],
    },
    actions: [{ stepId: "step_1", type: "webhook", params: { url: webhookUrl, signingSecret, allNotifications: true } }],
    expiresIn: "168h",
    repeat: { cooldown: "24h", maxTriggers: 3 },
  };
}

export function buildPriceQuery(webhookUrl: string, signingSecret: string, symbol: string, threshold: number): ElfaQuery {
  return {
    title: `${symbol} crosses ${threshold} (demo trigger)`,
    description: `Demonstration trigger: fire once when ${symbol} crosses above ${threshold} on Hyperliquid, then hand execution to KeeperHub.`,
    conditions: {
      AND: [
        { source: "price", method: "current", args: { symbol, exchange: "hyperliquid" }, operator: "crosses_above", value: threshold },
      ],
    },
    actions: [{ stepId: "step_1", type: "webhook", params: { url: webhookUrl, signingSecret, allNotifications: true } }],
    expiresIn: "1h",
  };
}

export const elfaValidate = (query: ElfaQuery) => call("/auto/queries/validate", { method: "POST", body: JSON.stringify({ query }) });
export const elfaCreate = (query: ElfaQuery) => call("/auto/queries", { method: "POST", body: JSON.stringify({ query }) });
export const elfaGet = (queryId: string) => call(`/auto/queries/${queryId}`);
export const elfaCancel = (queryId: string) => call(`/auto/queries/${queryId}/cancel`, { method: "POST" });
export const elfaList = () => call("/auto/queries");
```

- [ ] **Step 4: Write `cli/src/keeperhub.ts`**

```typescript
function base(): string {
  return process.env.KEEPERHUB_BASE ?? "https://app.keeperhub.com";
}

function apiKey(): string {
  const value = process.env.KEEPERHUB_API_KEY;
  if (!value) throw new Error("KEEPERHUB_API_KEY is not set");
  return value;
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KeeperHub ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const khUpdateWorkflow = (id: string, definition: unknown) =>
  call(`/api/workflows/${id}`, { method: "PATCH", body: JSON.stringify(definition) });

export const khGetWorkflow = (id: string) => call(`/api/workflows/${id}`);

export const khLastExecution = async (workflowId: string): Promise<unknown> => {
  const result = (await call(`/api/executions?workflowId=${workflowId}&limit=1`)) as { executions?: unknown[] };
  return result?.executions?.[0] ?? null;
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run cli/test/clients.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add cli
git commit -m "feat: Elfa and KeeperHub API clients"
```

---

### Task 9: `bridge setup`

**Files:**
- Create: `cli/src/setup.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/test/setup.test.ts`

**Interfaces:**
- Consumes: `cli/src/elfa.ts`, `cli/src/keeperhub.ts`
- Produces: `assertWorkerReachable(url)`, `runSetup(options)`; writes `ROUTES` to the Worker

- [ ] **Step 1: Write the failing test**

Create `cli/test/setup.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { assertWorkerReachable, mergeRoutes } from "../src/setup";

afterEach(() => vi.restoreAllMocks());

describe("assertWorkerReachable", () => {
  it("passes when /health answers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(assertWorkerReachable("https://bridge.example")).resolves.toBeUndefined();
  });

  it("explains the DNS requirement when the Worker is not deployed", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    await expect(assertWorkerReachable("https://bridge.example")).rejects.toThrow(/deploy the Worker first/i);
  });

  it("fails on a non-200 health response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(assertWorkerReachable("https://bridge.example")).rejects.toThrow(/500/);
  });
});

describe("mergeRoutes", () => {
  it("adds a new mapping without dropping the existing ones", () => {
    expect(mergeRoutes({ q1: "wf1" }, "q2", "wf2")).toEqual({ q1: "wf1", q2: "wf2" });
  });

  it("overwrites a re-created plan's mapping", () => {
    expect(mergeRoutes({ q1: "wf1" }, "q1", "wf9")).toEqual({ q1: "wf9" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run cli/test/setup.test.ts`
Expected: FAIL — cannot resolve `../src/setup`.

- [ ] **Step 3: Write `cli/src/setup.ts`**

```typescript
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildFundingQuery, buildPriceQuery, elfaCreate, elfaValidate, type ElfaQuery } from "./elfa";

export async function assertWorkerReachable(workerUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${workerUrl}/health`);
  } catch (error) {
    throw new Error(
      `Could not reach ${workerUrl}/health (${error}). Elfa resolves the webhook host in DNS when a plan is created, ` +
        `so deploy the Worker first with 'npx wrangler deploy'.`,
    );
  }
  if (!res.ok) throw new Error(`${workerUrl}/health returned ${res.status}`);
}

export function mergeRoutes(existing: Record<string, string>, queryId: string, workflowId: string): Record<string, string> {
  return { ...existing, [queryId]: workflowId };
}

function currentRoutes(): Record<string, string> {
  const toml = readFileSync("wrangler.toml", "utf8");
  const match = toml.match(/ROUTES\s*=\s*"(.*)"/);
  if (!match) return {};
  try {
    return JSON.parse(match[1].replaceAll('\\"', '"')) as Record<string, string>;
  } catch {
    return {};
  }
}

function publishRoutes(routes: Record<string, string>): void {
  // Vars live in wrangler.toml; rewriting it and redeploying is the only way to change them.
  const toml = readFileSync("wrangler.toml", "utf8");
  const serialised = JSON.stringify(routes).replaceAll('"', '\\"');
  const next = toml
    .replace(/ROUTES\s*=\s*".*"/, `ROUTES = "${serialised}"`)
    .replace(/BRIDGE_ENABLED\s*=\s*".*"/, 'BRIDGE_ENABLED = "true"');
  require("node:fs").writeFileSync("wrangler.toml", next);
  execFileSync("npx", ["wrangler", "deploy"], { stdio: "inherit" });
}

export async function runSetup(options: { film: boolean; threshold?: number }): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  const signingSecret = process.env.ELFA_SIGNING_SECRET;
  const workflowId = process.env.KEEPERHUB_WORKFLOW_ID;
  if (!workerUrl || !signingSecret || !workflowId) {
    throw new Error("WORKER_URL, ELFA_SIGNING_SECRET and KEEPERHUB_WORKFLOW_ID must all be set in .env");
  }

  await assertWorkerReachable(workerUrl);

  const query: ElfaQuery = options.film
    ? buildPriceQuery(`${workerUrl}/elfa`, signingSecret, "BTC", options.threshold ?? 0)
    : buildFundingQuery(`${workerUrl}/elfa`, signingSecret);

  const validation = (await elfaValidate(query)) as { valid: boolean; errors: unknown[] };
  if (!validation.valid) {
    throw new Error(`Elfa rejected the plan: ${JSON.stringify(validation.errors)}`);
  }

  const created = (await elfaCreate(query)) as { id: string };
  console.log(`Elfa plan created: ${created.id}`);

  publishRoutes(mergeRoutes(currentRoutes(), created.id, workflowId));
  console.log(`Routed ${created.id} → workflow ${workflowId}, bridge enabled.`);
}
```

- [ ] **Step 4: Write `cli/src/index.ts`**

```typescript
import { runSetup } from "./setup";

const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (command) {
    case "setup": {
      const film = rest.includes("--film");
      const thresholdArg = rest.indexOf("--threshold");
      const threshold = thresholdArg >= 0 ? Number(rest[thresholdArg + 1]) : undefined;
      await runSetup({ film, threshold });
      break;
    }
    default:
      console.error("usage: npm run bridge -- <setup|fire|status|teardown> [flags]");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run cli/test/setup.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add cli
git commit -m "feat: bridge setup with a DNS pre-flight and route publishing"
```

---

### Task 10: `bridge fire`, `status` and `teardown`

`fire` is both the test harness and three of the video's beats: it can produce a valid event, a duplicate, a stale one, a forged one, and an unrouted one on demand.

**Files:**
- Create: `cli/src/fire.ts`, `cli/src/status.ts`, `cli/src/teardown.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/test/fire.test.ts`

**Interfaces:**
- Consumes: `cli/src/elfa.ts`
- Produces: `signEvent(secret, eventId, timestamp, rawBody)`, `buildEvent(options)`, `runFire(options)`, `runStatus()`, `runTeardown()`

- [ ] **Step 1: Write the failing test**

Create `cli/test/fire.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signEvent, buildEvent } from "../src/fire";

const SECRET = "a".repeat(64);

describe("signEvent", () => {
  it("signs timestamp.eventId.body with the raw secret", () => {
    const body = '{"id":1}';
    const expected = createHmac("sha256", SECRET).update(`1775035200.42.${body}`).digest("hex");
    expect(signEvent(SECRET, "42", "1775035200", body)).toBe(`v1=${expected}`);
  });
});

describe("buildEvent", () => {
  it("shapes the body the way Elfa documents it", () => {
    const event = buildEvent({ eventId: "42", queryId: "q1" });
    const parsed = JSON.parse(event.rawBody);
    expect(parsed).toMatchObject({ type: "athena_query_notify_only", data: { queryId: "q1" } });
    expect(parsed).toHaveProperty("title");
    expect(parsed).toHaveProperty("createdAt");
  });

  it("backdates the timestamp when asked for a stale event", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const event = buildEvent({ eventId: "42", queryId: "q1", stale: true });
    expect(nowSec - Number(event.timestamp)).toBeGreaterThan(30);
  });

  it("produces a signature that will not verify when asked to forge one", () => {
    const good = buildEvent({ eventId: "42", queryId: "q1" });
    const bad = buildEvent({ eventId: "42", queryId: "q1", badSignature: true });
    expect(bad.signature).not.toBe(good.signature);
  });

  it("uses an unrouted query id when asked", () => {
    const event = buildEvent({ eventId: "42", queryId: "q1", unrouted: true });
    expect(JSON.parse(event.rawBody).data.queryId).toBe("not-a-routed-query");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run cli/test/fire.test.ts`
Expected: FAIL — cannot resolve `../src/fire`.

- [ ] **Step 3: Write `cli/src/fire.ts`**

```typescript
import { createHmac } from "node:crypto";

export interface EventOptions {
  eventId: string;
  queryId: string;
  stale?: boolean;
  badSignature?: boolean;
  unrouted?: boolean;
}

export interface BuiltEvent {
  eventId: string;
  timestamp: string;
  signature: string;
  rawBody: string;
}

export function signEvent(secret: string, eventId: string, timestamp: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${eventId}.${rawBody}`).digest("hex")}`;
}

export function buildEvent(options: EventOptions): BuiltEvent {
  const secret = process.env.ELFA_SIGNING_SECRET ?? "a".repeat(64);
  const nowSec = Math.floor(Date.now() / 1000);
  const timestamp = String(options.stale ? nowSec - 600 : nowSec);

  const rawBody = JSON.stringify({
    id: Number(options.eventId) || 12345,
    type: "athena_query_notify_only",
    category: "alerts",
    title: "BTC funding flips negative (Binance)",
    body: "annualized_rate crossed below 0",
    data: { queryId: options.unrouted ? "not-a-routed-query" : options.queryId },
    priority: "high",
    createdAt: new Date().toISOString(),
  });

  const signature = options.badSignature
    ? `v1=${"b".repeat(64)}`
    : signEvent(secret, options.eventId, timestamp, rawBody);

  return { eventId: options.eventId, timestamp, signature, rawBody };
}

export async function runFire(options: EventOptions): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) throw new Error("WORKER_URL is not set");

  const event = buildEvent(options);
  const res = await fetch(`${workerUrl}/elfa`, {
    method: "POST",
    headers: {
      "X-Auto-Event-Id": event.eventId,
      "X-Auto-Signature-Timestamp": event.timestamp,
      "X-Auto-Signature": event.signature,
      "Content-Type": "application/json",
    },
    body: event.rawBody,
  });
  console.log(`${res.status} ${await res.text()}`);
}
```

- [ ] **Step 4: Write `cli/src/status.ts`**

```typescript
import { elfaGet } from "./elfa";
import { khLastExecution } from "./keeperhub";

export async function runStatus(): Promise<void> {
  const workerUrl = process.env.WORKER_URL;
  const workflowId = process.env.KEEPERHUB_WORKFLOW_ID;
  if (!workerUrl || !workflowId) throw new Error("WORKER_URL and KEEPERHUB_WORKFLOW_ID must be set");

  const health = await (await fetch(`${workerUrl}/health`)).json();
  console.log("Worker:", health);

  const routes = JSON.parse(process.env.ROUTES ?? "{}") as Record<string, string>;
  for (const queryId of Object.keys(routes)) {
    const plan = (await elfaGet(queryId)) as {
      status?: string;
      latestEvaluation?: { evaluatedAt?: string; matchingConditions?: number; totalConditions?: number };
    };
    const evaluatedAt = plan.latestEvaluation?.evaluatedAt;
    const ageMinutes = evaluatedAt ? Math.round((Date.now() - Date.parse(evaluatedAt)) / 60000) : null;
    console.log(
      `Plan ${queryId}: status=${plan.status}, conditions met ${plan.latestEvaluation?.matchingConditions ?? "?"}/${plan.latestEvaluation?.totalConditions ?? "?"}, ` +
        `last evaluated ${ageMinutes === null ? "never" : `${ageMinutes} min ago`}`,
    );
    if (ageMinutes !== null && ageMinutes > 60) {
      console.log("  WARNING: this plan has not been evaluated in over an hour. Free-tier Auto access is not guaranteed.");
    }
  }

  const decisions = (await (await fetch(`${workerUrl}/audit`)).json()) as Array<{ at: string; eventId: string; decision: string }>;
  console.log("Last decisions:");
  for (const d of decisions.slice(0, 10)) console.log(`  ${d.at} ${d.eventId} ${d.decision}`);

  console.log("Last KeeperHub execution:", await khLastExecution(workflowId));
}
```

- [ ] **Step 5: Write `cli/src/teardown.ts`**

```typescript
import { elfaCancel, elfaList } from "./elfa";

export async function runTeardown(): Promise<void> {
  const result = (await elfaList()) as { data?: Array<{ id: string; status: string; title?: string }> };
  const plans = result.data ?? [];
  const active = plans.filter((p) => p.status === "active");

  if (active.length === 0) {
    console.log("No active plans to cancel.");
    return;
  }
  for (const plan of active) {
    await elfaCancel(plan.id);
    console.log(`Cancelled ${plan.id} (${plan.title ?? "untitled"})`);
  }
  console.log("Free-tier capacity released. Two active plans is the cap.");
}
```

- [ ] **Step 6: Wire the commands into `cli/src/index.ts`**

Replace the `switch` body with:

```typescript
import { runSetup } from "./setup";
import { runFire } from "./fire";
import { runStatus } from "./status";
import { runTeardown } from "./teardown";

const [command, ...rest] = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}

async function main(): Promise<void> {
  switch (command) {
    case "setup":
      await runSetup({ film: rest.includes("--film"), threshold: Number(flagValue("--threshold")) || undefined });
      break;
    case "fire":
      await runFire({
        eventId: flagValue("--event-id") ?? String(Date.now()),
        queryId: flagValue("--query-id") ?? Object.keys(JSON.parse(process.env.ROUTES ?? "{}"))[0] ?? "",
        stale: rest.includes("--stale"),
        badSignature: rest.includes("--bad-sig"),
        unrouted: rest.includes("--unrouted"),
      });
      break;
    case "status":
      await runStatus();
      break;
    case "teardown":
      await runTeardown();
      break;
    default:
      console.error("usage: npm run bridge -- <setup|fire|status|teardown> [flags]");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run cli/test/fire.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Commit**

```bash
git add cli
git commit -m "feat: fire, status and teardown commands"
```

---

### Task 11: End-to-end runs

**Files:**
- Modify: `docs/PROOF.md`

**Interfaces:**
- Consumes: everything
- Produces: recorded evidence of a full path on both chains

- [ ] **Step 1: Run the free Sepolia path**

```bash
# Create the Sepolia workflow via MCP create_workflow using workflow/keeperhub-workflow.sepolia.json,
# set KEEPERHUB_WORKFLOW_ID to its id, then:
npm run bridge -- setup --film --threshold 1
npm run bridge -- fire --event-id e2e-1
```
Expected: `200 forwarded:ok`. Check the KeeperHub execution log for a wrap transaction hash on Base Sepolia, and a Telegram message.

- [ ] **Step 2: Prove the duplicate guard against the live Worker**

```bash
npm run bridge -- fire --event-id e2e-1
```
Expected: `200 dropped:duplicate`, and **no** second KeeperHub execution.

- [ ] **Step 3: Prove the other refusals**

```bash
npm run bridge -- fire --event-id e2e-2 --bad-sig
npm run bridge -- fire --event-id e2e-3 --stale
npm run bridge -- fire --event-id e2e-4 --unrouted
curl -s "$WORKER_URL/audit" | head -40
```
Expected: `401`, `401`, `200 dropped:unrouted`. The audit page shows `refused:stale` and `dropped:unrouted` but **not** the forged one, because unsigned requests are never stored.

- [ ] **Step 4: Switch to mainnet and run the filmed path**

Set `KEEPERHUB_WORKFLOW_ID` back to the Base workflow. Refresh the floor as in Task 7 Step 2. Then:

```bash
npm run bridge -- teardown
npm run bridge -- setup --film --threshold <spot plus a hair>
npm run bridge -- status
```
Wait for Elfa to fire. Expected: an `/audit` row `forwarded:ok`, a KeeperHub execution ending in a swap, a Basescan transaction, a Telegram message.

- [ ] **Step 5: Restore the standing plan**

```bash
npm run bridge -- teardown
npm run bridge -- setup
npm run bridge -- status
```
Expected: the funding plan active, routed, and evaluating.

- [ ] **Step 6: Record and commit**

Append every id, hash and link to `docs/PROOF.md`.

```bash
git add docs/PROOF.md
git commit -m "docs: end-to-end proof on Base Sepolia and Base mainnet"
```

---

### Task 12: README, storyboard, and adversarial review

**Files:**
- Create: `README.md`, `video/STORYBOARD.md`

**Interfaces:**
- Consumes: `docs/PROOF.md`
- Produces: the submission artefacts

- [ ] **Step 1: Write `README.md`**

Roughly the first 30 percent is the problem, before the product is named. Structure:

1. **The problem** — Elfa Auto fires alerts on market conditions. It used to place orders and removed that; its docs now tell every user to "route follow-up execution through your own runner off a webhook". Quote it and link it. Say what goes wrong in a hand-rolled runner: a retried delivery executes twice, a forged POST executes once, and the amount lives in the message where anything upstream can change it.
2. **What this is** — the three-piece diagram from the spec.
3. **What it does not do** — no LLM in the path, no Hyperliquid execution, one operator.
4. **Run it** — prerequisites, `wrangler login`, `wrangler kv namespace create`, secrets, deploy, then `setup`, `fire`, `status`. State plainly that the Worker must be deployed before `setup`, because Elfa resolves the host in DNS.
5. **Proof** — the Basescan link and execution ids from `docs/PROOF.md`.
6. **Known limits** — the KV dedupe race and why the KeeperHub idempotency key is the real guarantee; the 0.97 floor will refuse if ETH runs hard; free-tier Auto access is documented as Grow-only yet worked; gas sponsorship unverified.

- [ ] **Step 2: Write `video/STORYBOARD.md`**

Use the beat table from spec §8, and include a fact-provenance table: every number said on camera, where it came from, and when it was measured. At minimum: the quote 4,978,247, the 0.0055 ETH cap, the 0.002 ETH amount, the daily-run limit of two, and the Elfa docs sentence.

- [ ] **Step 3: Run the full suite and an adversarial review**

```bash
npx vitest run
```
Expected: every test passes.

Then run `/code-review high` over the repository and fix what it finds before submitting.

- [ ] **Step 4: Commit**

```bash
git add README.md video/STORYBOARD.md
git commit -m "docs: problem-first README and video storyboard"
```

---

## Self-Review

**Spec coverage:** §4.1 Elfa plan → Tasks 8, 9. §4.2 Worker → Tasks 1–5. §4.3 workflow → Tasks 6, 7. §4.4 CLI → Tasks 8–10. §4.5 layout → Task 1. §5 failure table → tested in Tasks 4, 5, 6, 11. §6 invariants 1, 3, 4, 5, 7 → Task 5; 2 and 6 → Task 6. §7 testing → Tasks 2–7, 11, 12. §8 video → Task 12. §9 submission → Task 12. §10 operator actions → Tasks 1, 5, 7. §11 risks → the day-1 probe in Task 1 Step 10, the stall warning in Task 10 Step 4, the README limits in Task 12.

**Placeholder scan:** every code step contains runnable code. Two values are intentionally supplied at execution time and each has a step that produces it: the KV namespace id (Task 1 Step 4) and the Telegram integration and chat ids (Task 7 Step 1).

**Type consistency:** `Env` is defined once in `worker/src/index.ts` and imported by `forward.ts`. `Decision` is defined in `store.ts` and used in `index.ts`. `ForwardPayload` is defined in `forward.ts`. `ElfaQuery` is defined in `elfa.ts` and consumed by `setup.ts`. `buildEvent` and `signEvent` are used only by `fire.ts` and its test. Node labels in the workflow JSON match the labels used inside every template reference: `Check Balance`, `Quote`, `Swap`, `Wrap`.
