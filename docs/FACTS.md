# Fact provenance

Standing rule: every fact that reaches the README, the submission answers, or the video
storyboard carries a row here. A fact with no source does not ship.

| # | Claim | Source | Date checked | Status |
|---|---|---|---|---|
| 1 | Elfa Auto removed its `market_order` / `limit_order` execution actions and now tells users to "Route follow-up execution through your own runner off a `webhook`, `notify` or `telegram_bot` action." | Elfa public docs, quoted in spec §1 | 2026-09-06 | ✅ verified (direct quote) |
| 2 | Elfa resolves the webhook host in DNS at plan-creation time; an unresolvable host is rejected with `EQL_INVALID_ACTION: "Webhook URL host could not be resolved"` | Live probe, `POST /v2/auto/queries/validate` | 2026-09-07, re-confirmed 2026-09-09 | ✅ verified (reproducible) |
| 3 | The deployed bridge Worker is accepted by Elfa: same endpoint returned `{"valid":true,"errors":[]}` | Live probe against `https://elfa-keeperhub-bridge.meanwhile-waittime.workers.dev/elfa` | 2026-09-09 | ✅ verified |
| 4 | KeeperHub daily spending cap `effectiveDailyCapWei = 5500000000000000` (0.0055 ETH/day) | `get_spending_limits` probe | 2026-09-07 | ✅ verified |
| 5 | Uniswap V3 WETH→USDC on Base, fee 500, 0.002 ETH in → `result.amountOut = "4978247"` | `uniswap/quote-exact-input` probe | 2026-09-07 | ⚠️ price-sensitive, re-quote before filming |
| 6 | "August marked a new all-time high for our API usage, surpassing 3.83M in total requests." | [@elfa_ai on X](https://x.com/elfa_ai/status/2094726966264070642) — official Elfa account | 2026-09-09 | ✅ source cited; wording as relayed, confirm verbatim before publishing |

## Fact 6 — how to use it

Source is the integration partner's own official account, which is the strongest kind of
citation for this claim. Two cautions before it ships:

1. **Confirm the wording verbatim against the post** when writing the README and storyboard.
   The quote above is as Dami relayed it, not copied from the page. A misquoted usage figure
   in a submission the Elfa team may read is the worst place to be approximately right.
2. **Say what it decides, not just the number.** "3.83M API requests in August, an all-time
   high" is data. The point is: Elfa is a live, growing, paid product with real traders on it
   — so a bridge that makes its conditions actually execute serves existing users, rather than
   being a demo built against a toy. That is the main-track category's whole question.

Link the post rather than restating the number bare, so a judge can check it in one click.
