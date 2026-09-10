# Demo storyboard

Target length: 2 minutes 30 seconds. Worker 1.0.1 and all deterministic refusal evidence are ready.
Keep the terminal font large, hide `.env`, and never display a token, webhook key, signing secret,
Telegram chat ID, or full KeeperHub response body.

## Shot list

| Time | Picture | Narration and proof |
| --- | --- | --- |
| 0:00–0:18 | Elfa's August record post and website metrics | “Elfa reported 3.83 million requests in August after five record months. It monitors more than 4 million voices, tracks more than 600,000 tokens and markets, and powers more than 300 builder teams.” |
| 0:18–0:32 | Elfa's trade-removal article, then the Notifications signature contract | “Elfa retired trading to focus on intelligence for agents and execution venues. Its users now need a safe path from a high-volume trigger to an external wallet.” |
| 0:32–0:50 | `docs/architecture.html` | “This bridge connects Elfa's signed webhook to KeeperHub's authenticated trigger. Elfa decides when. KeeperHub fixes how.” |
| 0:50–1:05 | KeeperHub workflow canvas | Point to balance, quote, floor, swap, and Telegram nodes. “No amount, asset, chain, or recipient comes from the webhook. The workflow fixes a 0.002 ETH Base swap and checks two independent safety floors.” |
| 1:05–1:20 | Terminal: `npm test` | Show all 166 passing tests. Mention that the suite includes money-value invariants and deliberately broken mutations that fail. |
| 1:20–1:39 | Terminal: one valid `bridge fire`, then the HTML `/audit` page | “The Worker verifies the exact body bytes, freshness, route, and duplicate state. It forwards once with an idempotency key and records the decision.” Use a newly chosen event ID. The low wallet balance selects KeeperHub's no-funds branch and spends nothing. Do not call the harness event an Elfa-emitted event. |
| 1:39–1:55 | Repeat the same event ID; then fire stale, forged, and unrouted inputs | Show `dropped:duplicate`, `refused:stale`, and `dropped:unrouted`. Explain that the forged request does not appear in the audit because invalid signatures cause zero KV writes. |
| 1:55–2:15 | KeeperHub successful execution trace, then BaseScan transaction | “The funded proof run checked the balance, took a live Uniswap quote, swapped 0.002 ETH into 4.922114 USDC on Base, and sent the receipt to Telegram. KeeperHub sponsored the gas.” Keep the transaction hash visible. |
| 2:15–2:27 | KeeperHub balance-refusal trace and Telegram skip message | “A second run found only 0.000925 ETH, stopped before the quote and swap, produced no transaction, and still told the operator why.” |
| 2:27–2:30 | Architecture or project title | “Elfa decides when. KeeperHub decides how. The bridge makes the handoff safe.” |

## Recording checklist

- Deploy the current Worker and confirm `/health` reports version `1.0.1`.
- Confirm `/audit` loads before recording.
- Use the short-lived film plan, not the standing funding plan.
- Keep the Base workflow selected. Its low balance now guarantees a no-spend live bridge demo.
- Use fresh, non-secret event IDs for the valid, stale, forged, and unrouted shots.
- Confirm the duplicate attempt creates no second KeeperHub execution.
- Open the successful execution and BaseScan transaction in advance.
- Open the balance-refusal execution and Telegram conversation in advance.
- Show the genuine Elfa expiry audit row as a reliability finding, not as a market trigger. Explain
  that it caused the builders to opt out of lifecycle delivery and the Worker to add an explicit
  `dropped:lifecycle` gate.
- Show the later `e2e-20260910-lifecycle-v101` row to prove that gate is deployed, then the adjacent
  valid and duplicate version-1.0.1 rows.
- Close `.env`, shell history, settings pages, and any response panel containing account metadata.
- Record the final test count immediately before filming. If code changes after this draft, update
  the current count of 166.

## Fact provenance

Every measurable statement spoken on camera must match this table.

| Fact used on camera | Value | Source | Checked |
| --- | --- | --- | --- |
| Elfa August demand | `3.83M` total requests; more than `1.8M` developer API calls; five consecutive record months | [Elfa August post](https://x.com/elfa_ai/status/2094726966264070642); [developer-usage post](https://x.com/elfa_ai/status/2095503321855352866); [trade-removal article](https://www.elfa.ai/blog/trade-removal-doubling-down-on-agent-intelligence) | 2026-09-10 |
| Elfa product scale | `4M+` voices monitored; `600K+` tokens and markets tracked; more than `300` builder and product teams | [Elfa website](https://www.elfa.ai/) | 2026-09-10 |
| Elfa/runner responsibility | “Auto handles query evaluation and event emission”; the runner handles ingestion, verification and deduplication, continuation, audit, and retries | [Elfa Agent Runner](https://docs.elfa.ai/auto/agent-runner/) | 2026-09-10 |
| Webhook signature input | `HMAC_SHA256(secret, timestamp + "." + eventId + "." + rawBody)` | [Elfa Notifications](https://docs.elfa.ai/auto/notifications.md) | 2026-09-10 |
| Fixed swap amount | `0.002 ETH` | KeeperHub workflow `9lwespmlwr5ti4xyx817j`; `workflow/keeperhub-workflow.base.json` | 2026-09-10 |
| Wallet balance guard | `0.0025 ETH` | Same workflow, node `cond-bal` | 2026-09-10 |
| Effective daily spending cap | `0.0055 ETH` | KeeperHub spending-limit response, recorded in `docs/FACTS.md` | 2026-09-07 |
| Maximum full-size runs inside that cap | `2` | `floor(0.0055 / 0.002)` | 2026-09-10 |
| Executed quote and received amount | `4.922114 USDC` | KeeperHub execution `cgxl31n4l3sns4zy15pqc`, quote and swap nodes | 2026-09-10 |
| Successful Base transaction | `0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd` | [BaseScan](https://basescan.org/tx/0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd) | 2026-09-10 |
| Balance before successful run | `0.002925144547693724 ETH` | KeeperHub execution `cgxl31n4l3sns4zy15pqc` | 2026-09-10 |
| Balance at refusal | `0.000925144547693724 ETH` | KeeperHub execution `enykq0mq4ejhy1055wbm4` | 2026-09-10 |
| Gas | Sponsored; receipt reports `165265` gas units | KeeperHub execution `cgxl31n4l3sns4zy15pqc` | 2026-09-10 |

## Claims to avoid

- Do not say the filmed price trigger executed the successful swap. The successful transaction was
  a direct KeeperHub workflow proof run; the full Elfa→Worker live path still needs its audit row.
- Do not say the price-floor refusal was proven live. The live refusal was the balance guard.
- Do not claim LayerZero support in KeeperHub. The reviewed LayerZero change was approved but not
  confirmed merged when checked.
- Do not quote a final test count until the last clean run.
- Do not call the app trustless. It relies on one operator's Elfa, Cloudflare, and KeeperHub
  credentials.
