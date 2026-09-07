# Elfa → KeeperHub execution bridge — design

Date: 2026-09-06 (rev 2, 2026-09-07 after adversarial review)
Status: reviewed adversarially; findings applied; ready for implementation plan
Target: Agent Economy hackathon, main track "Best Integration into a Live Project" (close Sep 18 2026 12:00 CEST)

## 0. What changed in rev 2

An adversarial review found the money-moving node wrong in three ways at once, each of
which would have *run* and produced a wrong number rather than an error. Corrected here:

| Was (rev 1, wrong) | Is (rev 2, verified) |
|---|---|
| `amountIn = 0.002` (human ETH) | `amountIn = "2000000000000000"` (raw 18-dec integer); `ethValue = "0.002"` (human) — two different units on the same node |
| `{{@quote-1:Quote.amountOut}}` | `{{@quote-1:Quote.result.amountOut}}` — reads sit under `result` |
| `wrapped/deposit` on Sepolia | `wrapped/wrap` — `deposit` is not an action |
| Telegram needs no credentials | needs `integrationId` **and** `chatId`; `parseMode` must be `none` |
| "docs don't mention an allowlist" | docs do say "allowlisted host" — but the real check is **DNS resolution** (probed) |
| Worker checks timestamp then signature | signature first; unsigned traffic is never persisted |

Probes run 2026-09-07 (all free, no state changed):

- `POST /v2/auto/queries/validate` with an undeployed `*.workers.dev` URL →
  `EQL_INVALID_ACTION: "Webhook URL host could not be resolved"`. Same body with
  `https://example.com/elfa` and `https://httpbin.org/post` → `valid: true`.
  **⇒ no allowlist; the host must resolve in DNS at plan-creation time.**
- `get_spending_limits` → `effectiveDailyCapWei = 5500000000000000` (0.0055 ETH/day),
  `dailyUsedWei = 0`. **⇒ at most two 0.002 ETH runs per day.**
- `uniswap/quote-exact-input` on Base (8453), WETH→USDC, fee 500, amountIn
  `2000000000000000` → `result.amountOut = "4978247"` (4.978247 USDC; ETH ≈ $2,489),
  `gasEstimate` 72,987. **⇒ pool exists, path and units confirmed.**

## 1. Problem (read this first)

Elfa's **Auto** is a live, paid condition engine for traders. You describe a market
condition — a funding rate flipping negative, a liquidation cascade, a prediction-market
price crossing, a post from a named account — and Auto watches continuously and fires a
webhook when it becomes true.

Auto used to also *execute*: it had `market_order` and `limit_order` actions. Those were
removed. Elfa's own documentation now says:

> "Route follow-up execution through your own runner off a `webhook`, `notify` or
> `telegram_bot` action."

So every Elfa user who wants a condition to *do* something on-chain must now write and host
their own runner. A hand-rolled runner is exactly the component that double-fires on a
retried delivery, executes on a forged request, or moves the wrong amount.

KeeperHub is a deterministic execution layer: hosted wallet, gas sponsorship, spending caps,
per-step execution log, and an incoming webhook trigger. The two products cannot connect
today because KeeperHub's webhook trigger requires `Authorization: Bearer wfb_…` and Elfa's
webhook action sends only its own signature headers, with no way to add one.

**This project is the bridge.** Elfa decides *when*. KeeperHub decides *how*. The bridge
proves *who sent it* and *that it is not a repeat*, then hands off. Nothing in the bridge or
in the incoming payload can change *how much* moves.

## 2. Goals and non-goals

Goals
- Elfa Auto trigger → real on-chain value movement executed by KeeperHub on Base mainnet.
- Every delivery authenticated (HMAC), replay-bounded (30 s), de-duplicated (event id)
  before anything is forwarded.
- Every decision recorded and visible on a public read-only audit page.
- Amount, token pair, slippage floor and chain live **only** in the KeeperHub workflow.
- Workflow authored through KeeperHub's MCP (agent-built), with a visible refusal path.
- Reproducible by a judge: one `setup` command, one `fire` command.

Non-goals (deliberate)
- No execution on Hyperliquid — KeeperHub's Hyperliquid support is read-only (Info API).
- No LLM in the execution path. The pitch is deterministic execution.
- No multi-tenant use; one operator, one Elfa key, one KeeperHub org.
- Nothing of the operator's own products (Sentinel/Guardian) in the story or on camera.
- No UI beyond the audit page; KeeperHub's execution log is the UI.

## 3. Architecture

```
 Elfa Auto plan ──(HTTPS POST, HMAC-signed)──▶ Cloudflare Worker ──(POST + Bearer wfb_)──▶ KeeperHub workflow ──▶ Base mainnet
 (condition +      X-Auto-Event-Id             verify · dedupe ·      hosted app,              Uniswap V3 swap
  webhook action)  X-Auto-Signature            route · log (KV)       agent-authored           ETH → USDC
                   X-Auto-Signature-Timestamp        │                                            │
                                                     ▼                                            ▼
                                              GET /audit (public,                          Telegram message
                                              read-only decision log)                      with tx hash
```

| Piece | Owner | Purpose | Interface |
|---|---|---|---|
| Elfa plan | Elfa (created by our CLI) | decide *when* | outbound signed webhook |
| Worker | this repo | prove *who*, drop repeats, hand off, log | `POST /elfa`, `GET /audit`, `GET /health` |
| KeeperHub workflow | KeeperHub hosted app (via MCP) | decide *how*, execute | webhook trigger, execution log |

**Build order is forced by the DNS probe:** workflow first, then Worker deployed, then Elfa
plan. A plan cannot be created against a host that does not yet resolve.

## 4. Components

### 4.1 Elfa plan

Created by `bridge setup` via `POST /v2/auto/queries/validate` then `POST /v2/auto/queries`
using `ELFA_API_KEY`. Free tier verified working 2026-09-06 (one plan created and cancelled;
5 credits per create; 2 active plans max).

Headline plan (stays live through judging):

```json
{
  "title": "BTC funding flips negative (Binance)",
  "description": "Shorts now pay longs on Binance BTC perps. De-risk a fixed ETH slice into USDC via KeeperHub.",
  "conditions": {"AND": [{"source":"funding","method":"annualized_rate",
                 "args":{"ticker":"BTC:BINANCE"},"operator":"crosses_below","value":0}]},
  "actions": [{"stepId":"step_1","type":"webhook",
               "params":{"url":"https://<deployed-worker>/elfa","signingSecret":"<ELFA_SIGNING_SECRET>","allNotifications":true}}],
  "expiresIn": "168h",
  "repeat": {"cooldown":"24h","maxTriggers":3}
}
```

`repeat` shape and the funding condition were confirmed valid by the probe above (the only
rejection was the unresolvable host). `maxTriggers: 3` × 0.002 ETH = 0.006 ETH, which is
above the 0.0055 daily cap only if all three land in one day; the 24 h cooldown prevents that.

Filming plan (fires on demand): same action, condition `price.current` on `BTC`,
`exchange: hyperliquid`, `crosses_above` a threshold computed from live spot at creation
time, `expiresIn: 1h`, no repeat. `bridge setup --film` computes it.

Elfa delivery contract (docs re-read 2026-09-06, re-confirmed in review):

- Headers `X-Auto-Event-Id`, `X-Auto-Signature-Timestamp` (unix seconds),
  `X-Auto-Signature: v1=<hex>`.
- `HMAC_SHA256(signingSecret, timestamp + "." + eventId + "." + rawBody)`; the secret is the
  raw key, **not** hashed first (hashing is a legacy x402 fallback only).
- Documented body: `{ id, type, category, title, body, data: { queryId }, priority, createdAt }`.
- **Auto Trigger Context (`observedValue`, `triggerTime`) is NOT in the documented webhook
  body** — it appears in the SSE frame. The Worker treats both as optional (§4.2).
- No custom headers configurable. Hence the Worker.

### 4.2 Worker (`worker/`)

Cloudflare Workers, TypeScript, no framework. One KV namespace `BRIDGE`.

| Route | Auth | Behaviour |
|---|---|---|
| `POST /elfa` | Elfa HMAC | pipeline below; always answers in ~1 s |
| `GET /audit` | none | last 200 decisions from one `list()` call; `?format=html` renders a table |
| `GET /health` | none | `{ ok, enabled, routes, version, rejectedUnsigned }` |

Pipeline — **signature first, and unsigned traffic is never written to KV** (the free tier
allows 1,000 writes/day; persisting junk would exhaust it and disarm the dedupe guard):

1. Read raw body as text; read the three headers. Any missing → **400**, counter only.
2. Recompute HMAC, constant-time compare → mismatch → **401**, counter only, nothing stored.
3. Timestamp drift > 30 s either direction → **401** `refused:stale` (persisted — it is signed).
4. `BRIDGE_ENABLED !== "true"` → **200** `dropped:kill_switch`.
5. Parse JSON; read `data.queryId`; not in `ROUTES` → **200** `dropped:unrouted`.
6. KV `seen:<eventId>` present → **200** `dropped:duplicate`; else write (TTL 7 d).
7. Forward (below). 8. Persist one decision record. Return **200**.

Forwarding:

- `POST {KEEPERHUB_BASE}/api/workflows/<workflowId>/webhook` — note the trailing
  `/webhook`; rev 1 had this path wrong.
- Headers: `Authorization: Bearer <KEEPERHUB_WEBHOOK_KEY>`, `Content-Type: application/json`,
  **`Idempotency-Key: elfa-<eventId>`**. KeeperHub honours it for 24 h per workflow and
  replays the original `executionId`, so a retry can never execute twice. This is the real
  guarantee; the KV dedupe is a cheap first line, not the safety property.
- Response 2xx → `forwarded:ok` with KeeperHub's `executionId`.
- 400/401/403/404/410 → `forwarded:permanent_error` with the body; no retry.
- 429/5xx/network → `forwarded:retrying`; bounded retry inside `ctx.waitUntil` at 2 s, 10 s,
  30 s honouring `Retry-After`, same idempotency key; final outcome appended to the record.
  Elfa already has its 200, so it never retry-storms.

Forwarded body — **deterministic for a given event** (KeeperHub rejects a reused
idempotency key with a changed payload, so `receivedAt` must NOT be in it):

```json
{
  "source": "elfa-auto",
  "eventId": "12345",
  "queryId": "a12d20ff-…",
  "title": "BTC funding flips negative (Binance)",
  "body": "annualized_rate crossed below 0",
  "observedValue": null,
  "triggerTime": null
}
```

`observedValue` / `triggerTime` are read from trigger context **if present** and are `null`
otherwise. `title` and `body` are truncated to 200 characters and have `{{` and `}}` stripped
before forwarding, so nothing arriving from outside can become a KeeperHub template. No field
here is read by any numeric, address, token or chain input in the workflow (invariant §6.2).
The first live delivery's raw body is stored at `raw:<eventId>` (TTL 7 d) so the trigger-context
mapping can be corrected from evidence rather than guessed.

Storage layout (no read-modify-write anywhere — KV has no atomic update):

- `seen:<eventId>` → `"1"`, TTL 7 d.
- `decision:<reverseTs>:<eventId>` → empty value, **decision JSON in KV metadata**, TTL 30 d.
  `/audit` renders from a single `list({ prefix: "decision:", limit: 200 })`.
- `raw:<eventId>` → raw body, TTL 7 d.

Config

| Name | Kind | Meaning |
|---|---|---|
| `ELFA_SIGNING_SECRET` | secret | same value passed as `signingSecret` on the Elfa action (`openssl rand -hex 32`) |
| `KEEPERHUB_WEBHOOK_KEY` | secret | `wfb_…` from Settings › Developer › API keys › Webhook keys |
| `KEEPERHUB_BASE` | var | `https://app.keeperhub.com` |
| `BRIDGE_ENABLED` | var | `"true"` to forward; anything else = kill switch |
| `ROUTES` | var (JSON) | `{ "<elfaQueryId>": "<keeperhubWorkflowId>" }`, written by `bridge setup` |

### 4.3 KeeperHub workflow — "Elfa Auto → de-risk ETH to USDC (Base)"

Created on `app.keeperhub.com` through KeeperHub's MCP (`create_workflow` +
`validate_workflow`), so it is genuinely agent-authored on the real product.
Wallet integration `v0dqh167ypmjqxyds6tuh` (`0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`).
Telegram: a **new** integration named `elfa-bridge-telegram` — the existing
`guardian-telegram` name would appear in the on-camera execution log and read as the
operator's own product.

Fixed values (mainnet, from the live quote 4,978,247):

| Constant | Value | Note |
|---|---|---|
| `AMOUNT_IN_WEI` | `"2000000000000000"` | 0.002 ETH as a raw 18-decimal integer |
| `AMOUNT_IN_ETH` | `"0.002"` | same amount, human units, for `ethValue` only |
| `GAS_RESERVE_ETH` | `0.0005` | |
| `BALANCE_FLOOR_ETH` | `0.0025` | amount + reserve, compared against a human-ETH string |
| `MIN_USDC_OUT` (standing) | `"4828900"` | 0.97 × quote — loose enough to still fire days later |
| `MIN_USDC_OUT` (filming) | 0.995 × fresh quote | set by `--refresh-floor` minutes before filming |

Nodes:

| id | actionType | config |
|---|---|---|
| `trigger-1` | Webhook trigger | `webhookMockRequest` = the forwarded body (schema is not enforced by the route) |
| `bal-1` | `web3/check-balance` | `chainId 8453`, `address` = org wallet, `failOnError` **left at true** |
| `cond-bal` | `Condition` | `{{@bal-1:Check Balance.balance}} >= 0.0025` — output is a **human ETH string**, so this compares correctly |
| `quote-1` | `uniswap/quote-exact-input` | `network 8453`, tokenIn WETH `0x4200…0006`, tokenOut USDC `0x8335…2913`, `amountIn` = `AMOUNT_IN_WEI`, `fee "500"` |
| `cond-quote` | `Condition` | `{{@quote-1:Quote.result.amountOut}} >= 4828900` |
| `swap-1` | `uniswap/swap-exact-input` | same pair/fee, `recipient` = org wallet, `amountIn` = `AMOUNT_IN_WEI`, `amountOutMinimum` = `MIN_USDC_OUT`, **`ethValue` = `"0.002"`** (SwapRouter02 wraps `msg.value`; no approval needed) |
| `tg-ok` | `telegram/send-message` | `integrationId`, `chatId`, `parseMode: "none"`, "Executed <eventId>: <title> → {{@swap-1:Swap.transactionHash}}" |
| `tg-skip-bal` | `telegram/send-message` | on `cond-bal` false handle |
| `tg-skip-quote` | `telegram/send-message` | on `cond-quote` false handle, includes the observed quote |

`amountIn` and `ethValue` must describe the **same** amount in their two different units. If
`amountIn` exceeds `msg.value` the router tries to pull WETH and reverts; if it is smaller,
the excess ETH is stranded in the router with no refund path. This pairing is asserted by a
unit test over the workflow JSON (§6.6).

`parseMode` is `none` because the title "BTC funding flips negative (Binance)" contains
`(`, `)`, `.` and `-`, all of which Telegram's MarkdownV2 requires escaped; an unescaped
send returns 400 and would mark the execution failed *after* the swap already succeeded.

Sepolia variant (`--chain 84532`): Uniswap V3 is not registered on 84532, so there is no
quote and no `cond-quote`. Nodes: trigger → `bal-1` → `cond-bal` → `wrapped/wrap`
(`network 84532`, `ethValue "0.002"`) → Telegram. The quote-floor refusal path is
mainnet-only, and the README says so.

### 4.4 CLI (`cli/`)

Node 20+, TypeScript, `npx tsx`, reads `.env`.

| Command | Does |
|---|---|
| `bridge setup [--film] [--chain 8453\|84532] [--refresh-floor]` | creates/updates the workflow via MCP, deploys nothing (see order below), creates the Elfa plan after validating it, writes `ROUTES`, prints both ids. Idempotent on title. |
| `bridge fire [--event-id X] [--stale] [--bad-sig] [--unrouted]` | builds a synthetic Elfa event, signs it, POSTs to the Worker — the demo's failure cases |
| `bridge status` | Elfa `latestEvaluation` **and its age**, last 10 Worker decisions, last KeeperHub execution, remaining daily cap |
| `bridge teardown` | cancels plans created by setup (frees free-tier capacity), leaves the workflow |

Order enforced by `setup`: workflow → **Worker must already be deployed and resolving** →
Elfa plan. `setup` calls `GET /health` on the Worker URL first and refuses with a clear
message if it does not answer, because Elfa's validate rejects an unresolvable host.

### 4.5 Repository layout

```
elfa-keeperhub-bridge/
  README.md                      problem first (~30 %), then what it is, then run it
  docs/superpowers/specs/…       this file
  worker/                        src/{index,verify,store,forward}.ts, test/
  cli/                           src/{setup,fire,status,teardown,elfa,keeperhub}.ts
  workflow/                      keeperhub-workflow.base.json, .sepolia.json, action-schemas.fixture.json
  video/STORYBOARD.md            with fact-provenance table (standing rule)
  wrangler.toml, package.json, .env.example
```

## 5. Failure handling

| Failure | Caught where | Outcome |
|---|---|---|
| Forged / tampered request | Worker step 2 | 401, **not persisted**, counted in `/health` |
| Unsigned flood | Worker step 2 | 401, zero KV writes, dedupe budget intact |
| Replay of a captured request | Worker step 3 | 401 `refused:stale` |
| Elfa retries a delivery | Worker step 6, then KeeperHub `Idempotency-Key` | at most one execution |
| Operator paused the bridge | Worker step 4 | `dropped:kill_switch`, 200 |
| Plan not mapped | Worker step 5 | `dropped:unrouted`, 200 |
| KeeperHub 4xx (bad key, paused, missing) | forward classify | `forwarded:permanent_error` + body |
| KeeperHub 429/5xx | forward classify | bounded retry, same key, outcome appended |
| Wallet below amount + reserve | `cond-bal` | Telegram "skipped (balance)", no tx |
| Quote below floor | `cond-quote` | Telegram "skipped (quote …)", no tx |
| RPC failure on balance read | `failOnError` left true | run fails loudly — never a false "balance too low" |
| Daily cap (0.0055 ETH) exhausted | KeeperHub | execution refused; `bridge status` shows remaining cap |
| Swap reverts | KeeperHub simulation preflight | execution marked failed in the log |
| Runaway condition | `repeat` cooldown 24 h, `maxTriggers` 3, spending cap, kill switch | bounded loss |

After signature verification the Worker returns 200 for everything, so Elfa never
retry-storms. The audit log, not the HTTP status, is the record.

## 6. Invariants (asserted by tests)

1. A request whose signature fails is never forwarded, whatever else is true.
2. No field of the forwarded body is read by any numeric, address, token or chain input in
   the workflow JSON — asserted by scanning every node config for `trigger-1` references.
3. Two deliveries with the same event id produce at most one KeeperHub execution.
4. `BRIDGE_ENABLED` unset ⇒ nothing forwarded.
5. Secrets never appear in `/audit`, `/health`, logs or error bodies.
6. `swap-1.amountIn` (wei) and `swap-1.ethValue` (ETH) describe the same amount.
7. A failed-signature request performs zero KV writes.

## 7. Testing

1. **Unit** (vitest + `@cloudflare/vitest-pool-workers`): verify (good/bad sig, ±31 s drift,
   missing headers), store (dedupe, metadata listing), forward (payload determinism,
   idempotency header, error classification, retry schedule), index (check ordering, kill
   switch, unrouted). Every Worker-owned row in §5 gets a test.
2. **Workflow JSON**: invariants 2 and 6; every Condition edge carries a `sourceHandle`;
   every `actionType` exists in the committed `action-schemas.fixture.json`.
3. **Manual mainnet dry run, day 1, before any Worker code** — run the workflow by hand with
   `webhookMockRequest` ($5 of real value). This is the single riskiest step; proving it
   first means the rest is deterministic and offline-testable.
4. **End-to-end Sepolia (free)**: `setup --chain 84532`, `fire`, assert a wrap tx hash and an
   `/audit` row; re-fire the same event id → `dropped:duplicate`.
5. **End-to-end mainnet (once, filmed)**: `setup --film`, wait for the fire, confirm Basescan,
   Telegram, `/audit`.
6. **Adversarial review** (`/code-review high`) before submission — house rule.

## 8. Demo video (main track, 2–3 min, face + voice, problem first)

| t | Beat | On screen |
|---|---|---|
| 0:00–0:40 | Problem: Elfa fires alerts, removed order execution, told everyone to build their own runner — and that runner is what double-fires | the Elfa docs sentence |
| 0:40–1:05 | Shape: Elfa decides when, KeeperHub decides how, the bridge proves who and not-again | §3 diagram |
| 1:05–2:10 | Live: plan fires → `/audit` `forwarded:ok` → KeeperHub log bal → quote → swap → Telegram → Basescan | split screen |
| 2:10–2:35 | Reliability: same event id → duplicate dropped; `--bad-sig` → refused; floor above spot → skip branch | `/audit` rows |
| 2:35–2:55 | What's live now: the funding plan through judging; workflow authored via MCP; repo | KeeperHub workflow page |

Bounty video is separate: 60–90 s screen capture, no voiceover, per the organisers' Discord answer.

## 9. Submission checklist

Public repo with problem-first README · live URL = the Worker's `/audit` · video link ·
transaction link = the filmed Basescan swap · surfaces used: hosted app, MCP authoring,
webhook trigger, Uniswap + Telegram plugins · mainnet (Base), Sepolia path documented.

## 10. Costs and operator actions

| Item | Cost | Who |
|---|---|---|
| Elfa plans | 5 credits each (1,000/mo free) | CLI |
| Cloudflare Workers + KV | free tier (1,000 writes/day — §4.2 protects it) | Dami: `npx wrangler login` once, interactive |
| KeeperHub webhook key | free | Dami: Settings › Developer › API keys › Webhook keys |
| Telegram | free | Dami: create `elfa-bridge-telegram` integration + supply the chat id |
| Base ETH | ~$10 (0.002 per run, cap 0.0055/day) | Dami: fund `0xDfcF…7d98` |

## 11. Risks and open questions

- **Trigger context in webhook bodies is undocumented.** Handled by making both fields
  nullable and storing the first raw body; no message depends on them.
- **Free-tier Auto access is documented as Grow-only** yet a create succeeded on 2026-09-06.
  Treat access as not guaranteed: keep ≤2 active plans, `teardown` before `setup --film`,
  and have `bridge status` show the age of the last evaluation so a stalled plan is visible.
- **Standing floor at 0.97 will still refuse if ETH runs hard.** That is the honest design —
  refuse rather than swap badly — and the README says so.
- **Gas sponsorship is unverified.** The daily cap is known (0.0055 ETH) and charged against
  payable value; gas on top is assumed sponsored but not proven. Day-1 manual run settles it.
- **Elfa's retry schedule is undocumented.** The idempotency key makes it irrelevant.
- **Calendar.** This competes with AWS (Sep 14) and Commons (Sep 17). Budget is three focused
  days; anything past §4 is cut, not stretched.
