# What we are building

Plain-language source of truth for the README, the submission answers and the finalist call.
Written 2026-09-10. Keep the numbers in `docs/FACTS.md` in sync with this.

## The problem

Elfa Auto is a condition engine for traders. You describe a market condition in words and it
watches continuously, firing when the condition becomes true. Something like: Bitcoin funding on
Binance flips negative, meaning shorts start paying longs, which usually says the market has
leaned too far one way.

Elfa used to place the order for you as well. They removed that. Their documentation now tells
users to route follow-up execution through their own runner, off a webhook, notify or
telegram_bot action.

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

Built and reviewed, 132 tests passing: the deployed Worker, signature verification, KV storage,
payload building and forwarding with retries, the request pipeline and public audit page, and both
workflow definitions with 41 invariant tests.

Not built: creating the workflow on KeeperHub for real, proving the swap by hand, the CLI that
wires setup together, the live end-to-end runs, and the README and video.

Operator actions still outstanding:

- A Telegram integration named `elfa-bridge-telegram`. The only one on the account today is
  `guardian-telegram`, and the spec bans that name from any on-camera surface.
- The chat id for that integration.
- A webhook key (`wfb_...`) from Settings, Developer, API keys.
- Base ETH in `0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`, roughly $10.

Confirmed live on 2026-09-10 with the org API key: wallet integration `v0dqh167ypmjqxyds6tuh`
resolves to `0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`, matching the spec.
