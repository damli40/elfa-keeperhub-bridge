# DoraHacks submission draft

Use this for the **main-track BUIDL only**. The KeeperHub feature bounty belongs to a separate
BUIDL and repository.

## Required links

- Source code: `[ADD PUBLIC REPOSITORY URL]`
- Demo video: `[ADD VIDEO URL]`
- KeeperHub transaction proof:
  https://basescan.org/tx/0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd
- Live bridge: https://elfa-keeperhub-bridge.meanwhile-waittime.workers.dev
- Contact email: `[ADD EMAIL]`
- X or Discord: `[ADD HANDLE]`

Do not submit until all three required links are public and open in a private browser window.

## Project name

Elfa → KeeperHub Bridge

## One-line description

A signed, idempotent execution bridge that turns Elfa Auto market triggers into fixed KeeperHub
workflows on Base, with refusal paths and a public decision audit.

## Which project did you integrate with, and what does the integration do?

We integrated KeeperHub with Elfa Auto, a live market condition and event-emission service. Elfa
can monitor funding, price, technical indicators, social signals, and other market conditions, but
post-trigger execution belongs to an external runner.

The bridge makes that handoff safe for an on-chain action. A Cloudflare Worker verifies Elfa's
HMAC over the exact request body, rejects stale and duplicate deliveries, routes only configured
Elfa query IDs, adds KeeperHub's bearer authentication, and forwards the event ID as an
idempotency key. KeeperHub then executes a reviewed workflow whose amount, tokens, chain,
recipient, balance floor, and price floor are fixed independently of the webhook payload.

The demonstrated workflow checks the wallet balance, takes a live Uniswap V3 quote, swaps a fixed
0.002 ETH into USDC on Base when both guards pass, and sends the transaction hash to Telegram.
Every accepted or refused bridge decision appears in a public audit view.

## Which KeeperHub surfaces did you use?

- KeeperHub's agent-authored workflow model and workflow API for construction and validation
- KeeperHub webhook triggers for deterministic downstream execution
- Hosted wallet and spending cap
- Uniswap V3 quote and exact-input swap actions on Base
- Telegram action for success and refusal receipts
- Execution trace, verified transaction hash, and audit record
- Gas sponsorship for the successful mainnet transaction

MCP/API access was used while authoring and validating the workflow. The runtime path uses the
KeeperHub webhook and the reviewed workflow. We did not use x402 or MPP and do not claim that we
did.

## Testnet or mainnet?

Base mainnet.

KeeperHub execution `cgxl31n4l3sns4zy15pqc` swapped 0.002 ETH into 4.922114 USDC. The receipt is
successful and KeeperHub marked the transaction hash verified:

https://basescan.org/tx/0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd

A second execution, `enykq0mq4ejhy1055wbm4`, stopped at the 0.0025 ETH balance guard, sent the
skip notification, and produced no transaction.

## Reliability and observability

Reliability is the core of the integration, not an extra screen added to a happy path.

- Invalid HMAC: rejected before any storage write
- Request older than 30 seconds: rejected and audited
- Signed expiry or failure notification: dropped and audited, never executed
- Unknown query ID: dropped and audited
- Duplicate event ID: dropped before a second KeeperHub call
- Cloudflare KV race: KeeperHub receives the same idempotency key as the final duplicate guard
- KeeperHub transient failure: retried in the background with fixed backoff and the same bytes
- Kill switch: signed events are acknowledged and dropped
- Low wallet balance or bad quote: workflow branches to Telegram without reaching the swap
- Public `/audit`: shows recent decisions without raw webhook bodies or secrets

The repository has 166 tests. The workflow tests pin the exact money amount, token addresses,
wallet address, chain, fee tier, price floor, and Telegram integration. We deliberately mutated
those values during review and confirmed that the tests fail.

## What still breaks or is unfinished?

The mainnet KeeperHub execution and balance-refusal proofs are complete. Cloudflare Worker version
1.0.0 is deployed, enabled, and routed. Live signed-harness requests proved the successful
Worker-to-KeeperHub path, duplicate suppression, forged and stale refusals, unrouted handling, and
the public audit. The resulting KeeperHub run stopped at the low-balance guard and sent Telegram
without producing a transaction.

The short-lived Elfa price plan did not emit a market-triggered webhook before it expired. Elfa did
send its correctly signed expiry notification to the live Worker, proving genuine Elfa delivery.
That lifecycle event exposed an integration flaw: `allNotifications: true` subscribed the
execution endpoint to expiry and failure notifications. The builders now opt out, and the Worker
explicitly drops any signed lifecycle status even if a future query is misconfigured.

The CLI harness signs the exact Elfa-documented timestamp, event ID, and raw-body contract, but we
do not present that harness request as an Elfa-emitted market trigger.

Worker version 1.0.1 is now deployed with a standing Elfa funding plan. A live routed expiry probe
returned `dropped:lifecycle` without calling KeeperHub. A fresh valid event forwarded once, its
duplicate was dropped, and KeeperHub execution `7c6xsp26ijw29w5laz3cq` stopped at the balance
guard, sent Telegram, and created no transaction.

The price-floor refusal is covered by invariant and branch tests but was not reached in a second
mainnet run. After the successful swap, the wallet balance fell below the balance guard, so the
later live refusal stopped earlier and moved no funds. KeeperHub's simulator also does not simulate
the protocol-specific Uniswap action; the successful Base receipt is the proof for that node.

Cloudflare KV is eventually consistent. Its local duplicate mark is a fast filter, while the Elfa
event ID propagated to KeeperHub as an idempotency key is the final protection against a race.

## Why this fits the main track

This is specific to the authentication and delivery contracts of two live products. Elfa signs a
webhook but cannot add KeeperHub's bearer header; KeeperHub executes reviewed workflows but cannot
accept Elfa's signature directly. The bridge closes that exact gap.

It moved value through KeeperHub on Base mainnet and leaves a verifiable transaction. It also
shows the failure cases a real operator faces: forgeries, replay, duplicate delivery, bad routes,
dependency errors, low balance, an unfavorable quote, and an emergency stop. Another team can
reproduce it through the checked-in workflow definitions, CLI, tests, proof record, and setup
instructions.

## Final submission checklist

- [ ] Credentials shared during development rotated: KeeperHub API key, KeeperHub webhook key,
  and Telegram bot token; new values installed in `.env`, Cloudflare, and the KeeperHub Telegram
  integration as applicable
- [x] Lifecycle-hardened Worker deployed; `/health` says `version: 1.0.1`, `enabled: true`,
  `routes: 1`
- [x] `/audit` is public and contains valid, duplicate, stale, and unrouted harness decisions
- [x] Forged request is absent from `/audit`
- [x] README's stale-deployment statement resolved
- [x] `docs/PROOF.md` includes the live Elfa plan ID and Worker audit event IDs
- [ ] Video follows `video/STORYBOARD.md` and shows no secret-bearing surfaces
- [ ] Public repository URL opens while logged out
- [ ] Video URL opens while logged out
- [ ] BaseScan transaction opens while logged out
- [ ] Form has reachable email and X or Discord contact
- [ ] Main-track BUIDL is separate from the feature-bounty BUIDL
- [ ] Submission completed before Sep 18, 12:00 CEST
