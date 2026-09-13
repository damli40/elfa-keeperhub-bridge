# Submission text, short form (drafted 2026-09-12)

Paste-ready for the DoraHacks form. Long-form answers with sources stay in `docs/SUBMISSION.md`.
Every number here traces to `docs/FACTS.md` and `video/STORYBOARD.md`.

## Project name

Elfa → KeeperHub Bridge

## Description

Elfa Auto watches a market condition and fires a signed webhook. A Cloudflare Worker checks the
signature, drops stale, duplicate and lifecycle events, and forwards once to a fixed KeeperHub
workflow. KeeperHub checks the wallet, takes a live Uniswap quote, swaps 0.002 ETH to USDC on Base
and posts the receipt to Telegram. The webhook cannot change the amount, token, chain or recipient.
Every decision lands in a public audit log.

## Vision (200 characters)

Every Elfa condition can move money through KeeperHub without the user hosting a runner. Elfa
decides when. KeeperHub decides how much. The webhook can't touch the amount.

## Which project did you integrate with, and what does the integration do?

Elfa Auto, Elfa's live condition engine (3.83M requests in August). Elfa retired its own trade
page and now tells users to run post-trigger execution through their own runner. That runner is
the piece that double-fires on a retry or executes a forged request.

Elfa's webhook cannot add the bearer header KeeperHub's trigger requires, so the two products
cannot talk directly. The bridge closes that gap: it verifies Elfa's HMAC over the raw body,
refuses anything older than 30 seconds, drops repeats by event ID, and forwards with an
idempotency key so KeeperHub itself blocks a second spend. KeeperHub then runs a reviewed
workflow: balance check, live quote, price floor, swap, Telegram. Proof: execution
`cgxl31n4l3sns4zy15pqc`, tx `0x79ab494c…10cd`, 0.002 ETH → 4.922114 USDC, gas sponsored.

## What still breaks or is unfinished?

- No Elfa market trigger has fired end to end. The short price plan expired before its condition
  hit. Elfa did deliver one genuine signed expiry event, which exposed that we had subscribed the
  execution endpoint to lifecycle notifications. We fixed the opt-in and added an explicit
  `dropped:lifecycle` gate. Every valid live event since came from our signed CLI harness.
- The successful swap was launched against KeeperHub directly, not through an Elfa event.
- The wallet holds 0.000925 ETH, under the 0.0025 guard, so every live run now stops at the
  balance branch and moves nothing until we refund it.
- The price-floor refusal is proven by tests only. Live refusals so far all hit the balance guard.
- KeeperHub's daily cap is 0.0055 ETH, so two full runs a day at most.
- KeeperHub's simulator reports zero simulated nodes for the Uniswap swap. The Base receipt is the
  only proof for that node.
- The `/health` counters are per Cloudflare isolate, so they under-count global traffic.
- The Base Sepolia workflow file exists but was never run.

## Contact

demiladeakins@gmail.com · X @rookie_of_Ph · GitHub damli40
