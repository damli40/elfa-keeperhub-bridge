# Elfa → KeeperHub execution bridge — design

Date: 2026-09-06
Status: approved in conversation, pending written review
Target: Agent Economy hackathon, main track "Best Integration into a Live Project" (close Sep 18 2026 12:00 CEST)

## 1. Problem (read this first)

Elfa's **Auto** is a live, paid condition engine for traders. You describe a market
condition — a funding rate flipping negative, a liquidation cascade, a Polymarket price
crossing, an X post from a named account — and Auto watches continuously and fires a
webhook when it becomes true.

Auto used to also *execute*: it had `market_order` and `limit_order` actions. Those were
removed. Elfa's own documentation now says:

> "Route follow-up execution through your own runner off a `webhook`, `notify` or
> `telegram_bot` action."

So every Elfa user who wants a condition to *do* something on-chain now has to write and
host their own runner. A hand-written or agent-written runner is exactly the component that
double-fires on a retried delivery, executes on a forged request, or moves the wrong amount.

KeeperHub is a deterministic execution layer with a hosted wallet, gas sponsorship, spending
limits and a per-step execution log. It already exposes an incoming webhook trigger. The two
products do not connect today because KeeperHub's webhook trigger requires an
`Authorization: Bearer wfb_…` key and Elfa's webhook action cannot send custom headers
(it sends only its own HMAC signature headers).

**This project is the bridge.** Elfa decides *when*; KeeperHub decides *how*; the bridge
proves *who* sent the event and *that it is not a repeat*, then hands off. Nothing in the
bridge or in the incoming payload can change *how much* moves.

## 2. Goals and non-goals

Goals
- Elfa Auto trigger → real on-chain value movement executed by KeeperHub on Base mainnet.
- Every delivery is authenticated (HMAC), replay-bounded (30 s window) and de-duplicated
  (event id) before anything is forwarded.
- Every decision — forwarded, duplicate, bad signature, stale, kill-switched, KeeperHub
  error — is recorded and visible on a public read-only audit page.
- Amount, token pair, slippage floor and chain live only in the KeeperHub workflow.
- The KeeperHub workflow is authored through KeeperHub's MCP (agent-built), and has a
  visible refusal path (balance too low, quote below floor).
- Reproducible by a judge: one `setup` command creates the Elfa plan; one `fire` command
  sends a synthetic signed event end-to-end.

Non-goals (deliberate)
- No execution on Hyperliquid. KeeperHub's Hyperliquid support is read-only (Info API).
- No LLM anywhere in the execution path. The pitch is deterministic execution.
- No multi-tenant use; one operator, one Elfa key, one KeeperHub org.
- No integration with the operator's own products (Sentinel/Guardian stay out).
- No custom UI beyond the audit page. KeeperHub's own execution log is the UI.

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

Three pieces, each independently testable:

| Piece | Owner | Purpose | Interface |
|---|---|---|---|
| Elfa plan | Elfa (created by our CLI) | Decide *when* | Outbound webhook, documented headers/body |
| Worker | this repo | Prove *who*, drop repeats, hand off, log | `POST /elfa`, `GET /audit`, `GET /health` |
| KeeperHub workflow | KeeperHub hosted app (created via MCP by our CLI) | Decide *how*, execute | Webhook trigger, execution log |

## 4. Components

### 4.1 Elfa plan

Created by `bridge setup` through `POST /v2/auto/queries/validate` then
`POST /v2/auto/queries` with the operator's `ELFA_API_KEY` (free tier is sufficient:
verified 2026-09-06, a plan was created and cancelled; 5 credits per create; 2 active
plans max on free tier).

Headline plan (stays live through judging):

```json
{
  "title": "BTC funding flips negative (Binance)",
  "description": "Shorts now pay longs on Binance BTC perps. De-risk a fixed ETH slice into USDC via KeeperHub.",
  "conditions": {"AND": [{"source":"funding","method":"annualized_rate",
                 "args":{"ticker":"BTC:BINANCE"},"operator":"crosses_below","value":0}]},
  "actions": [{"stepId":"step_1","type":"webhook",
               "params":{"url":"https://<worker>/elfa","signingSecret":"<ELFA_SIGNING_SECRET>","allNotifications":true}}],
  "expiresIn": "168h",
  "repeat": {"cooldown":"24h","maxTriggers":3}
}
```

Filming plan (fires on demand): same action, condition
`price.current BTC on hyperliquid crosses_above <spot + 0.05 %>` (or `crosses_below`),
`expiresIn: 1h`, no repeat. `bridge setup --film` computes the threshold from the live
price at creation time. The Discord answer confirms the main-track demo may be any live
run; the funding-flip plan is the story, the price plan is the camera.

Elfa delivery contract (from docs.elfa.ai/auto/notifications, re-read 2026-09-06):

- Headers: `X-Auto-Event-Id`, `X-Auto-Signature-Timestamp` (unix seconds),
  `X-Auto-Signature: v1=<hex>`.
- Signature: `HMAC_SHA256(signingSecret, timestamp + "." + eventId + "." + rawBody)`.
  The secret is the raw key; it is **not** hashed first.
- Body: `{ id, type, category, title, body, data: { queryId }, priority, createdAt }`,
  plus Auto Trigger Context where present.
- No custom headers can be configured on the action. Hence the Worker.

### 4.2 Worker (`worker/`)

Runtime: Cloudflare Workers, TypeScript, no framework. Storage: one KV namespace `BRIDGE`.

Routes

| Route | Auth | Behaviour |
|---|---|---|
| `POST /elfa` | Elfa HMAC | The pipeline below. Always answers within ~1 s. |
| `GET /audit` | none | Last 200 decisions as JSON (`?format=html` renders a plain table). Public, read-only. |
| `GET /health` | none | `{ ok, enabled, routes: n, version }`. |

Pipeline for `POST /elfa` (each step logs a decision and stops on failure):

1. Read raw body as text. Parse headers. Missing header → `refused:missing_header` (400).
2. `now - timestamp > 30 s` (either direction) → `refused:stale` (401).
3. Recompute HMAC with `ELFA_SIGNING_SECRET`; constant-time compare → `refused:bad_signature` (401).
4. `BRIDGE_ENABLED !== "true"` → `dropped:kill_switch` (200, so Elfa does not retry).
5. Parse JSON; read `data.queryId`. Unknown queryId → `dropped:unrouted` (200).
6. KV `seen:<eventId>` exists → `dropped:duplicate` (200). Otherwise write it (TTL 7 d).
   KV is eventually consistent; a second delivery inside the same few ms can pass. Stated
   in README; Elfa's cooldown makes it unreachable in practice.
7. POST to `KEEPERHUB_WEBHOOK_URL/<workflowId>` with `Authorization: Bearer <KEEPERHUB_WEBHOOK_KEY>`
   and the fixed-shape payload below. Non-2xx → `forwarded:keeperhub_error` with the
   response body (200 to Elfa). 2xx → `forwarded:ok` with KeeperHub's execution id.
8. Write `decision:<ts>:<eventId>` to KV (TTL 30 d) and append its key to a rolling index
   `decisions:recent` (capped at 200).

Forwarded payload (fixed shape; **no amounts, no addresses**):

```json
{
  "source": "elfa-auto",
  "eventId": "12345",
  "queryId": "a12d20ff-…",
  "title": "BTC funding flips negative (Binance)",
  "body": "annualized_rate crossed below 0",
  "observedValue": "-3.21",
  "triggerTime": "2026-09-06T19:00:00.000Z",
  "receivedAt": "2026-09-06T19:00:01.104Z"
}
```

Configuration (Worker secrets / vars)

| Name | Kind | Meaning |
|---|---|---|
| `ELFA_SIGNING_SECRET` | secret | Same value passed as `signingSecret` on the Elfa action. Generated by `openssl rand -hex 32`. |
| `KEEPERHUB_WEBHOOK_KEY` | secret | `wfb_…` from KeeperHub Settings › Developer › Webhook keys. |
| `KEEPERHUB_WEBHOOK_URL` | var | `https://app.keeperhub.com/api/workflows` |
| `BRIDGE_ENABLED` | var | `"true"` to forward; anything else = kill switch. |
| `ROUTES` | var (JSON) | `{ "<elfaQueryId>": "<keeperhubWorkflowId>" }`. Written by `bridge setup`. |

Decision record (what `/audit` shows):

```json
{ "at": "…", "eventId": "…", "queryId": "…", "decision": "forwarded:ok",
  "detail": { "workflowId": "…", "executionId": "…" }, "latencyMs": 412 }
```

### 4.3 KeeperHub workflow ("Elfa de-risk: ETH → USDC on Base")

Created on `app.keeperhub.com` by `bridge setup` through KeeperHub's MCP
(`create_workflow` + `validate_workflow`), so it is an agent-authored workflow on the
real product. Wallet integration: the org's existing Base wallet
(`0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`, integration `v0dqh167ypmjqxyds6tuh`).
Notifications: the existing `guardian-telegram` integration (`ircsuib7u5kxv79detk1f`).

Nodes (ids fixed so templates are stable):

| id | action | config (fixed values live here) |
|---|---|---|
| `trigger-1` | Webhook | `webhookSchema` = the forwarded payload |
| `bal-1` | `web3/check-balance` | chainId 8453, address = org wallet |
| `cond-bal` | Condition | `{{@bal-1:Balance.balance}} >= AMOUNT_IN_ETH + GAS_RESERVE_ETH` |
| `quote-1` | `uniswap/quote-exact-input` | chainId 8453, tokenIn WETH `0x4200…0006`, tokenOut USDC `0x8335…2913`, fee 500, amountIn = AMOUNT_IN_ETH |
| `cond-quote` | Condition | `{{@quote-1:Quote.amountOut}} >= MIN_USDC_OUT` |
| `swap-1` | `uniswap/swap-exact-input` | same pair, `recipient` = org wallet, `amountIn` = AMOUNT_IN_ETH, `amountOutMinimum` = MIN_USDC_OUT, `ethValue` = AMOUNT_IN_ETH (native ETH in; KeeperHub's write step wraps because `exactInputSingle` is payable) |
| `tg-ok` | `telegram/send-message` | "Executed: <eventId> <title> → tx {{@swap-1:Swap.transactionHash}}" |
| `tg-skip-bal` | `telegram/send-message` | "Skipped (balance): …" on `cond-bal` false |
| `tg-skip-quote` | `telegram/send-message` | "Skipped (quote {{@quote-1:Quote.amountOut}} < floor): …" on `cond-quote` false |

Fixed values for the mainnet run: `AMOUNT_IN_ETH = 0.002` (≈ $5 at the time of writing),
`GAS_RESERVE_ETH = 0.0005`, `MIN_USDC_OUT` = 0.995 × the quote taken at setup time,
re-computed by `bridge setup --refresh-floor` before filming. The floor is a **hard-coded
number in the workflow**, not a percentage computed at run time, so the refusal path is
deterministic and demonstrable (set the floor above spot → the skip branch fires).

The Sepolia variant (`--chain 84532`) uses `wrapped/deposit` (WETH) instead of the swap,
because Uniswap V3 is not registered on Base Sepolia in KeeperHub. Same trigger, same
conditions, same Telegram nodes.

### 4.4 CLI (`cli/`)

Node 20+, TypeScript, run with `npx tsx`. Reads `.env`. Commands:

| Command | Does |
|---|---|
| `bridge setup [--film] [--chain 8453\|84532]` | Creates/validates the KeeperHub workflow via MCP HTTP, creates the Elfa plan (validate → create), writes `ROUTES` to the Worker via `wrangler secret`/vars, prints both ids. Idempotent: re-running updates rather than duplicates (keys on title). |
| `bridge fire [--event-id X] [--stale] [--bad-sig]` | Builds a synthetic Elfa event, signs it with `ELFA_SIGNING_SECRET`, POSTs to the Worker. Flags produce the failure cases for the demo. |
| `bridge status` | Elfa plan state (`latestEvaluation`), last 10 Worker decisions, last KeeperHub execution. |
| `bridge teardown` | Cancels Elfa plans created by setup; leaves the workflow. |

### 4.5 Repository layout

```
elfa-keeperhub-bridge/
  README.md                      problem first (~30 %), then what it is, then run it
  docs/superpowers/specs/…       this file
  worker/                        src/index.ts, src/verify.ts, src/store.ts, src/forward.ts, test/
  cli/                           src/setup.ts, fire.ts, status.ts, teardown.ts, elfa.ts, keeperhub.ts
  workflow/                      keeperhub-workflow.base.json, keeperhub-workflow.sepolia.json (exported)
  video/STORYBOARD.md            with fact-provenance table (standing rule)
  wrangler.toml, package.json, .env.example
```

## 5. Failure handling

| Failure | Where caught | Outcome |
|---|---|---|
| Elfa retries a delivery | Worker step 6 | `dropped:duplicate`, 200 |
| Replay of a captured request | Worker step 2 | `refused:stale`, 401 |
| Forged or tampered request | Worker step 3 | `refused:bad_signature`, 401 |
| Operator paused the bridge | Worker step 4 | `dropped:kill_switch`, 200 |
| Elfa plan not mapped | Worker step 5 | `dropped:unrouted`, 200 |
| KeeperHub 4xx/5xx (bad key, workflow paused, quota) | Worker step 7 | `forwarded:keeperhub_error` + body, 200 to Elfa |
| Wallet below amount + reserve | `cond-bal` | Telegram "skipped (balance)", no tx |
| Price moved so quote < floor | `cond-quote` | Telegram "skipped (quote)", no tx |
| Swap reverts on-chain | KeeperHub write step (simulation preflight) | Execution fails in KeeperHub's log; Worker already returned 200 |
| Runaway condition | Elfa `repeat.cooldown` 24 h, `maxTriggers` 3; KeeperHub spending limits | Bounded loss |

The Worker returns 200 for everything after signature verification so Elfa never
retry-storms; the audit log, not the HTTP status, is the source of truth.

## 6. Security invariants (assert in tests)

1. The Worker never forwards a request whose signature failed, whatever else is true.
2. The forwarded payload contains no field that the workflow uses as an amount, address,
   token or chain. (Test: schema of forwarded payload has none of those keys, and the
   workflow JSON has no template referencing `trigger-1` in any numeric/address field.)
3. Two deliveries with the same `X-Auto-Event-Id` produce at most one forward (modulo the
   documented KV race).
4. `BRIDGE_ENABLED` unset ⇒ nothing is forwarded.
5. Secrets never appear in `/audit`, `/health` or logs.

## 7. Testing

1. **Unit (vitest + `@cloudflare/vitest-pool-workers`)**: verify.ts (good sig, bad sig,
   drift ±31 s, missing headers), store.ts (dedupe, index cap), forward.ts (payload shape,
   error capture), index.ts (kill switch, unrouted, ordering of checks). Target: every row
   in §5 that the Worker owns has a test.
2. **Workflow JSON**: a test loads `workflow/*.json` and asserts invariant §6.2, every
   Condition edge has a `sourceHandle`, and every action type exists in KeeperHub's
   `list_action_schemas` snapshot (committed fixture).
3. **End-to-end, Sepolia (free)**: `bridge setup --chain 84532`, then `bridge fire`;
   assert a KeeperHub execution with a `transactionHash` on Base Sepolia and an
   `/audit` row `forwarded:ok`. Then `bridge fire --event-id <same>` → `dropped:duplicate`.
4. **End-to-end, mainnet (once, filmed)**: `bridge setup --film`, wait for Elfa to fire,
   confirm Basescan tx of the swap, Telegram message, `/audit` row.
5. **Adversarial review** before submission (`/code-review high`), per house rule.

## 8. Demo video (main track, 2–3 min, face + voice, problem first)

| t | Beat | On screen |
|---|---|---|
| 0:00–0:40 | Problem. Elfa fires alerts; it removed order execution; everyone now hand-rolls a runner; that runner is the thing that double-fires. | Elfa docs quote, then the hand-rolled-runner failure list |
| 0:40–1:05 | Shape. Elfa decides when, KeeperHub decides how, the bridge proves who and not-again. | The §3 diagram |
| 1:05–2:10 | Live. Create the film plan on camera (`bridge setup --film`); Elfa evaluates; Worker `/audit` shows `forwarded:ok`; KeeperHub execution log runs bal → quote → swap → Telegram; Basescan shows the swap. | Split screen: terminal, KeeperHub, Basescan, Telegram |
| 2:10–2:35 | Reliability. `bridge fire --event-id <same>` → duplicate dropped. `--bad-sig` → refused. Floor above spot → workflow skip branch. | `/audit` rows appearing |
| 2:35–2:55 | What's running now: the funding-flip plan live through judging; workflow was agent-authored via MCP; repo link. | README, KeeperHub workflow page |

Bounty video (separate BUIDL): 60–90 s screen capture, no voiceover, per the Discord answer.

## 9. Submission checklist (main track BUIDL)

- Repo public with README (problem first), `bridge setup` reproducible.
- Live URL: the Worker's `/audit` page.
- Video link.
- Transaction link: the Basescan swap tx from the filmed run.
- Surfaces used: hosted app, MCP (workflow authoring), webhook trigger, Uniswap + Telegram plugins.
- Testnet or mainnet: mainnet (Base), with Sepolia path documented.

## 10. Costs and operator (Dami) actions

| Item | Cost | Who |
|---|---|---|
| Elfa plans | 5 credits each (free tier, 1,000/mo) | CLI |
| Cloudflare Workers + KV | free tier | Dami: `npx wrangler login` once (interactive) |
| KeeperHub webhook key | free | Dami: Settings › Developer › API keys › Webhook keys |
| KeeperHub org wallet on Base | ≈ $10 ETH (0.002 swapped + reserve) | Dami: fund `0xDfcF…7d98`; gas is sponsored by KeeperHub |
| Telegram | existing integration | none |

## 11. Risks and open questions

- **KV race** (§4.2 step 6): documented, not solved. Durable Objects would solve it; out of scope.
- **Elfa webhook host allowlist**: the skill text says "allowlisted host"; the docs page does
  not mention one. First `bridge setup` run will tell. If allowlisting is required, the
  Worker URL is added in Elfa's dashboard; no design change.
- **Native ETH swap path**: KeeperHub's write step treats `exactInputSingle` as payable and
  expects `tokenIn = WETH` with `ethValue` set. If the hosted build differs, fall back to
  `wrapped/deposit` + ERC-20 `approve-token` + swap (three nodes instead of one).
- **Funding-flip may not fire during judging.** The story does not depend on it; the
  filmed run and the `bridge fire` reproduction do.
- **Calendar**: this competes with AWS (Sep 14) and Commons (Sep 17). Build budget is
  three focused days; anything beyond §4 is cut, not stretched.
