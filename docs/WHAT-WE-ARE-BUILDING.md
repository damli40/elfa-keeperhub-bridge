# What we are building

Plain-language source of truth for the README, the submission answers and the finalist call.
Written 2026-09-10. Keep the numbers in `docs/FACTS.md` in sync with this.

## The problem

Elfa Auto is a condition engine for traders. You describe a market condition in words and it
watches continuously, firing when the condition becomes true. Something like: Bitcoin funding on
Binance flips negative, meaning shorts start paying longs, which usually says the market has
leaned too far one way.

Elfa's current documentation makes Auto the condition and event-emission control plane. It tells
operators to continue post-trigger work in an Agent Runner, which must handle event ingestion,
verification and deduplication, downstream delivery, audit logging, and retries.

So every Elfa user who wants a condition to actually do something on-chain has to build and host
the most dangerous component themselves. That runner is exactly the piece that fires twice when a
webhook gets retried, or executes on a forged request because nobody checked the signature, or
moves the wrong amount because a number arrived in the wrong unit.

## Why the two products cannot just be connected

KeeperHub already does execution properly: hosted wallet, gas sponsorship, spending caps, and a
log of every step. It even accepts an incoming webhook.

KeeperHub's webhook trigger requires an `Authorization: Bearer wfb_...` header. Elfa's webhook
action sends only its own signature headers and offers no way to add one. The two products cannot
talk. That gap is the reason this project exists.

## What we are building

A small program that sits between them.

Elfa decides when. KeeperHub decides how. The bridge proves who sent it, and that it is not a
repeat.

### 1. The Elfa plan

A condition plus a webhook action pointing at the bridge, signed with a shared secret.

### 2. The bridge

A Cloudflare Worker, deployed and live at
https://elfa-keeperhub-bridge.meanwhile-waittime.workers.dev

When a message arrives it:

- recomputes the signature and rejects anything that fails, before writing anything down
- rejects anything more than 30 seconds old, so a captured request cannot be replayed later
- drops a repeat of an event id it has already seen
- forwards to KeeperHub with the bearer token Elfa could not send, plus an idempotency key so a
  retry can never execute twice
- writes every decision to a public page at `/audit`, refusals included

### 3. The KeeperHub workflow

Checks the wallet balance, takes a live Uniswap quote, refuses if the price sits below a floor,
swaps 0.002 ETH into USDC on Base, then sends a Telegram message carrying the transaction hash.

## The one idea that matters

No amount, token, chain or address ever comes from the message.

All of those live in the KeeperHub workflow, fixed. The incoming message may only say that the
condition fired. It cannot influence how much moves or where it goes. A test scans every field of
the workflow definition to prove no money value reads from the incoming payload.

That guard is why the 2026-09-09 review findings mattered. The tests protecting those values did
not pin them: halving the swap amount passed 27 of 27, and redirecting the payout to a
`0xDEADBEEF` address passed 36 of 36. Both now fail, verified by breaking them on purpose.

## Why it fits the rubric

The main-track rubric asks five things. The third is whether the build survives conditions that
are not the happy path. That is the entire bridge: forged signature, replayed request, duplicate
delivery, KeeperHub unreachable, wallet below the floor, price moved against you, operator hits
the kill switch. Each has a defined outcome and a row in the audit log.

Most submissions show the happy path. This one is built around everything else.

## Status on 2026-09-10

The bridge, workflow, API clients, setup/fire/status/teardown CLI, README, and demo storyboard are
built. The current suite has 162 passing tests after the final adversarial review.

The KeeperHub workflow is live. It swapped 0.002 ETH into 4.922114 USDC on Base, sent the success
Telegram message, and produced a verified transaction receipt. A second run stopped at the wallet
balance guard, sent the skip message, and produced no transaction.

The remaining gate is deployment of the current Worker. The public URL still serves an older,
disabled build with no `/audit` route. After the operator deploys version 1.0.0, Task 11 can record
the signed, duplicate, stale, forged, and unrouted Elfa-to-Worker paths without making another
mainnet swap.
