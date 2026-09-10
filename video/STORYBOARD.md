# Demo storyboard

Target length: 2 minutes 30 seconds. Record this only after the current Worker is deployed and the
Task 11 audit rows exist. Keep the terminal font large, hide `.env`, and never display a token,
webhook key, signing secret, Telegram chat ID, or full KeeperHub response body.

## Shot list

| Time | Picture | Narration and proof |
| --- | --- | --- |
| 0:00–0:18 | Elfa Agent Runner documentation, with “Auto handles query evaluation and event emission” visible | “Elfa can decide when a market condition is true. Its own runner guide leaves verification, deduplication, continuation, retries, and audit to the downstream operator.” |
| 0:18–0:32 | Elfa Notifications signature contract | “That boundary matters when the next action moves money. A retry must not trade twice, and a forged or stale request must never reach the wallet.” |
| 0:32–0:50 | `docs/architecture.html` | “This bridge connects Elfa's signed webhook to KeeperHub's authenticated trigger. Elfa decides when. KeeperHub fixes how.” |
| 0:50–1:05 | KeeperHub workflow canvas | Point to balance, quote, floor, swap, and Telegram nodes. “No amount, asset, chain, or recipient comes from the webhook. The workflow fixes a 0.002 ETH Base swap and checks two independent safety floors.” |
| 1:05–1:20 | Terminal: `npm test` | Show all 162 passing tests. Mention that the suite includes money-value invariants and deliberately broken mutations that fail. |
| 1:20–1:39 | Terminal: one valid `bridge fire`, then the HTML `/audit` page | “The Worker verifies the exact body bytes, freshness, route, and duplicate state. It forwards once with an idempotency key and records the decision.” Use a newly chosen event ID. The low wallet balance should select KeeperHub's no-funds branch and spend nothing. |
| 1:39–1:55 | Repeat the same event ID; then fire stale, forged, and unrouted inputs | Show `dropped:duplicate`, `refused:stale`, and `dropped:unrouted`. Explain that the forged request does not appear in the audit because invalid signatures cause zero KV writes. |
| 1:55–2:15 | KeeperHub successful execution trace, then BaseScan transaction | “The funded proof run checked the balance, took a live Uniswap quote, swapped 0.002 ETH into 4.922114 USDC on Base, and sent the receipt to Telegram. KeeperHub sponsored the gas.” Keep the transaction hash visible. |
| 2:15–2:27 | KeeperHub balance-refusal trace and Telegram skip message | “A second run found only 0.000925 ETH, stopped before the quote and swap, produced no transaction, and still told the operator why.” |
| 2:27–2:30 | Architecture or project title | “Elfa decides when. KeeperHub decides how. The bridge makes the handoff safe.” |

## Recording checklist

- Deploy the current Worker and confirm `/health` reports version `1.0.0`.
- Confirm `/audit` loads before recording.
- Use the short-lived film plan, not the standing funding plan.
- Keep the Base workflow selected. Its low balance now guarantees a no-spend live bridge demo.
- Use fresh, non-secret event IDs for the valid, stale, forged, and unrouted shots.
- Confirm the duplicate attempt creates no second KeeperHub execution.
- Open the successful execution and BaseScan transaction in advance.
- Open the balance-refusal execution and Telegram conversation in advance.
- Close `.env`, shell history, settings pages, and any response panel containing account metadata.
- Record the final test count immediately before filming. If code changes after this draft, update
  the current count of 162.

## Fact provenance

Every measurable statement spoken on camera must match this table.

| Fact used on camera | Value | Source | Checked |
| --- | --- | --- | --- |
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
