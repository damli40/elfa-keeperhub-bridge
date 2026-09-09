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
| 6 | "August marked a new all-time high for our API usage, surpassing 3.83M in total requests." | An X post — **URL NOT CAPTURED** | — | 🔴 **UNVERIFIED — DO NOT SHIP** |

## Fact 6 — what is missing

Dami reported seeing this in an X post. Needed before it can appear anywhere:
the posting account handle, the post URL, and the post date.

Why it matters: the main-track category is "Best Integration into a Live Project", so a
number showing Elfa is live and growing is genuinely load-bearing for the pitch — and
misquoting the integration partner's own usage figure in a submission they may read is
the worst place to be wrong. Either cite it exactly or drop it and say "Elfa Auto is a
live paid product" without a number.
