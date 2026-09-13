# Fact provenance

Standing rule: every fact that reaches the README, the submission answers, or the video
storyboard carries a row here. A fact with no source does not ship.

| # | Claim | Source | Date checked | Status |
|---|---|---|---|---|
| 1 | Elfa Auto handles query evaluation and event emission; its Agent Runner guide assigns the downstream runner event ingestion, verification and deduplication, strategy continuation, audit logging, and retries. | [Elfa Agent Runner](https://docs.elfa.ai/auto/agent-runner/) | 2026-09-10 | ✅ verified against current first-party documentation |
| 2 | Elfa resolves the webhook host in DNS at plan-creation time; an unresolvable host is rejected with `EQL_INVALID_ACTION: "Webhook URL host could not be resolved"` | Live probe, `POST /v2/auto/queries/validate` | 2026-09-07, re-confirmed 2026-09-09 | ✅ verified (reproducible) |
| 3 | The deployed bridge Worker is accepted by Elfa: same endpoint returned `{"valid":true,"errors":[]}` | Live probe against `https://elfa-keeperhub-bridge.meanwhile-waittime.workers.dev/elfa` | 2026-09-09 | ✅ verified |
| 4 | KeeperHub daily spending cap `effectiveDailyCapWei = 5500000000000000` (0.0055 ETH/day) | `get_spending_limits` probe | 2026-09-07 | ✅ verified |
| 5 | The executed Uniswap V3 WETH→USDC quote on Base, fee 500, returned `result.amountOut = "4922114"` for 0.002 ETH | KeeperHub execution `cgxl31n4l3sns4zy15pqc`, node `quote-1` | 2026-09-10 | ✅ verified in the successful workflow run; price-sensitive, re-quote before filming |
| 7 | All six workflow action types exist in KeeperHub's live schema list: `Condition`, `telegram/send-message`, `uniswap/quote-exact-input`, `uniswap/swap-exact-input`, `web3/check-balance`, `wrapped/wrap` | KeeperHub MCP `list_action_schemas`, exact-string match | 2026-09-09 | ✅ verified against the live API |
| 9 | KeeperHub's **live production API** exposes **9 Chainlink CCIP actions** (`chainlink/ccip-get-fee`, `ccip-send`, `ccip-bnm-drip`, `ccip-approve-bridge-token`, `ccip-check-bridge-balance`, `ccip-check-bridge-allowance`, `ccip-approve-fee-token`, `ccip-check-fee-balance`, `ccip-check-fee-allowance`) and **0 LayerZero actions** | KeeperHub MCP `search_protocol_actions`, queries "ccip" (count 9), "layerzero" (count 0), "oft" (count 0) | 2026-09-09 | ✅ verified live |
| 10 | PR #2322 (issue #2307, payable-value encode transforms) is **MERGED** into KeeperHub staging; issue #2307 closed as completed | GitHub notification, 2026-09-08 18:57 UTC | 2026-09-09 | ✅ verified |
| 11 | PR #2323 (LayerZero protocol: OFT, token and EndpointV2 reads) is **APPROVED, NOT MERGED** | @joelorzet review, 2026-09-09 22:17 UTC | 2026-09-09 | ⚠️ approved only — **do NOT write "KeeperHub supports LayerZero"** |
| 8 | `wrapped/deposit` is not a real KeeperHub action; the wrapped family is `wrap` / `unwrap` / `balance-of` | same call as fact 7 | 2026-09-09 | ✅ verified — corroborates spec rev 2 |
| 6 | Elfa surpassed 3.83M total requests in August 2026 after five consecutive months of record usage; Elfa also reported more than 1.8M developer API calls during August. | [@elfa_ai August record](https://x.com/elfa_ai/status/2094726966264070642); [Elfa trade-removal article](https://www.elfa.ai/blog/trade-removal-doubling-down-on-agent-intelligence); [@elfa_ai developer usage](https://x.com/elfa_ai/status/2095503321855352866) | 2026-09-10 | ✅ verified against two first-party posts and Elfa's first-party article |
| 12 | KeeperHub workflow `9lwespmlwr5ti4xyx817j` swapped 0.002 ETH into 4.922114 USDC on Base mainnet and sent the success Telegram message | KeeperHub execution `cgxl31n4l3sns4zy15pqc`; [BaseScan transaction](https://basescan.org/tx/0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd) | 2026-09-10 | ✅ receipt status success; KeeperHub marked the hash verified |
| 13 | A second workflow run stopped at the balance guard, sent the skip Telegram message, and created no transaction | KeeperHub execution `enykq0mq4ejhy1055wbm4` | 2026-09-10 | ✅ execution trace ended at `tg-skip-bal`; transaction hash list empty |
| 14 | Worker version 1.0.0 accepted a correctly signed routed harness event, forwarded it to KeeperHub, and dropped a repeat of the same event ID without a second execution | Public Worker `/health` and `/audit`; KeeperHub execution `ux12mjb6qkrnyret2k37w` | 2026-09-10 | ✅ verified live; execution trace ended at the balance-refusal Telegram node with no transaction |
| 15 | The live Worker rejected a forged signature with 401, rejected a stale signed event with 401, and dropped an unrouted signed event with 200; the forged event created no public audit row | CLI responses and public Worker `/audit` for events `e2e-20260910-forged`, `e2e-20260910-stale`, and `e2e-20260910-unrouted` | 2026-09-10 | ✅ verified live |
| 16 | Elfa emitted a correctly signed expiry notification for the film plan; the live Worker accepted its signature and created audit event `3e191c8a-3ee6-4a5c-a91c-840d5551ccc1` without reaching KeeperHub | Elfa query `b814b6e5-097e-41b4-a93b-73169661ba53` status plus public Worker `/audit` | 2026-09-10 | ✅ proves genuine Elfa delivery; it was a lifecycle event, not a market trigger |
| 17 | Deployed Worker 1.0.1 returned `dropped:lifecycle` for a correctly signed, routed expiry probe, then forwarded a fresh valid event exactly once; KeeperHub stopped at the balance guard and sent Telegram without a transaction | Public Worker `/health` and `/audit`; standing Elfa plan `d3564e99-ac6b-495a-9880-81f020c423d7`; KeeperHub execution `7c6xsp26ijw29w5laz3cq` | 2026-09-10 | ✅ lifecycle and duplicate hardening verified live |
| 18 | Elfa reports 4M+ voices monitored, 600K+ tokens and markets tracked, 80K+ posts processed daily, 310K+ verified accounts, and more than 300 builder and product teams. | [Elfa official website](https://www.elfa.ai/) | 2026-09-10 | ✅ verified against current first-party website |

## Fact 6 — how to use it

Source is the integration partner's own official account, which is the strongest kind of
citation for this claim. Two cautions before it ships:

1. **Use the exact category.** Elfa's trade-removal article (re-read 2026-09-13) says: "exponential growth
   in API usage, reaching an all-time high for five consecutive months and surpassing 3.83M requests."
   So "3.83M API requests in August" is Elfa's own framing and is safe to say. Elfa separately reported
   more than 1.8M developer API calls; do not swap the two numbers.
2. **Connect scale to the execution gap.** Elfa is a live product with rising developer usage. It
   retired trading to focus on intelligence for execution venues and financial agents, so its
   users need a safe way to connect triggers to an external execution layer.

Link the post rather than restating the number bare, so a judge can check it in one click.
