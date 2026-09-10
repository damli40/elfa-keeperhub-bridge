# Handoff

Written 2026-09-10. Read this, then `docs/WHAT-WE-ARE-BUILDING.md` for the plain-language
explanation, then the plan. Everything below was verified in-session, not recalled.

## One-line state

Tasks 1 to 6 of 12 complete, 132 tests passing, the Worker deployed and accepted by Elfa.
Blocked at Task 7 on operator actions only. Branch `feat/bridge-implementation`, head `a3dc2cc`,
23 commits.

---

## The deadline situation, read this first

| Date | What happens |
|---|---|
| 2026-09-12 | Dami's weekly Claude limit resets |
| 2026-09-13 | Dami's Anthropic subscription ends |
| 2026-09-14 17:00 PT | GrantHound (AWS) closes, competes for the same window |
| 2026-09-18 12:00 CEST | This hackathon closes. Nothing accepted after. |
| 2026-09-18 to 25 | Judging. Up to 10 finalists present live. |

Tasks 7 to 12 need an assistant. The usable window is 12 and 13 September on the fresh weekly
limit. After the 13th Dami works unassisted, so anything that must be done with help should be
done by then. Manual work (video, form filling, recording a transaction) survives fine without.

## What the hackathon wants

Agent Economy on DoraHacks. Two tracks, separate BUIDLs required for each.

- **Main track, $4,000 ranked** (2000 / 1200 / 800): best integration of KeeperHub into a live
  project. This repo is that entry.
- **Bounty, $1,000, two winners at $500**: a mergeable PR to the KeeperHub repo.
  **Already submitted** from a different codebase, `~/Desktop/keeperhub`, PRs #2322 (merged) and
  #2323 (approved). Not this repo. Do not conflate them.

Submission requires three things and incomplete submissions cannot be judged: a source code
link, a short demo video showing the integration working, and a link to a transaction executed
through KeeperHub.

Main-track rubric, in their words:

1. Integration depth. Is there a real, named project on the other side, and is the integration
   specific to it?
2. Execution through KeeperHub. Did value actually move, and can we see it?
3. Reliability and observability. Does the build survive conditions that are not the happy path?
4. Usefulness and originality.
5. Developer experience and code quality.

Item 3 is where this build is strongest and it should be led with. The refusal ladder, the
public audit page, the idempotency key and the adversarial-review findings all serve it.

Form questions to expect: which project and what the integration does; which KeeperHub surfaces
were used; testnet or mainnet; what still breaks or is unfinished (their note says a candid
answer has never hurt a submission); a reachable contact.

## How the work is being run

`superpowers:subagent-driven-development`, at Dami's explicit instruction:
**Sonnet implements, Opus reviews.** Keep that split.

- Plan: `docs/superpowers/plans/2026-09-07-elfa-keeperhub-bridge.md`, 12 tasks.
- Spec, the binding authority: `docs/superpowers/specs/2026-09-06-elfa-keeperhub-bridge-design.md` (rev 2).
- **Ledger: `.superpowers/sdd/2026-09-07-elfa-keeperhub-bridge/progress.md`, 431 lines, 18 rulings.**
  Git-ignored. It is the recovery map. Read it before re-dispatching anything: a task with a
  `Task N: complete` line is done.
- Task briefs 2 to 6 are pre-generated in that directory. Generate 7 onward with
  `scripts/task-brief` from the SDD skill directory.

### The review lesson this build keeps teaching

Four separate times an agent reported work as verified with no evidence attached, and each time
re-running it found something. Two examples worth carrying forward:

- A coordinated edit halving the swap amount passed 27 of 27 tests.
- Redirecting the payout address to `0xDEADBEEF` passed 36 of 36 tests.

Both are fixed. The method that caught them: break the thing on purpose, watch the suite go red,
restore, watch it go green, and paste both outputs. **Require that evidence from implementers.
Do not accept a self-reported "FAILED" column.** A maintainer on the separate bounty PR found
the same class of defect in Dami's code independently on the same day.

## Where the code stands

Done and reviewed, 132 tests across 6 files:

| Task | What | Rounds of fixes |
|---|---|---|
| 1 | Worker scaffold, deployed, `/health` | 0 |
| 2 | HMAC signature verification | 1 |
| 3 | KV storage, decision records, audit listing | 1 |
| 4 | Payload building, KeeperHub forwarding, retry classification | 3 |
| 5 | The pipeline, `/audit`, `/health` | 2 |
| 6 | Both workflow JSONs, 41 invariant tests | 3 |

Not started: Task 7 (create the workflow on KeeperHub, prove the swap by hand), Task 8 (API
clients), Task 9 (`bridge setup`), Task 10 (`bridge fire`, `status`, `teardown`), Task 11
(end-to-end runs), Task 12 (README, storyboard, adversarial review).

## Live facts, verified in-session

- Worker deployed: `https://elfa-keeperhub-bridge.meanwhile-waittime.workers.dev`
  `/health` returns `{"ok":true,"enabled":false,"routes":0,"version":"0.1.0"}`.
- **Elfa accepts that host.** `POST /v2/auto/queries/validate` returned `{"valid":true,"errors":[]}`
  on 2026-09-09. The DNS-resolution blocker on all Elfa plan creation is cleared.
- KV namespace `BRIDGE` = `ea7d424e780c4b82843288fa97cb3258`.
- KeeperHub org API key works. `/api/workflows` and `/api/integrations` both return 200.
  Stored in `.env` as `KEEPERHUB_API_KEY`. `/api/v1/workflows` and `/api/executions` are 404;
  the spending-limits path was not found under four guesses.
- Wallet integration `v0dqh167ypmjqxyds6tuh` resolves to
  `0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`, matching the spec.
- All six workflow action types exist in KeeperHub's live schema list.
- Numbers and their provenance live in `docs/FACTS.md`. Fact 6, the Elfa usage stat, is sourced
  to @elfa_ai on X but its wording is still Dami's paraphrase. Confirm verbatim before publishing.

## Blocked on operator actions only

1. **A Telegram integration named `elfa-bridge-telegram`.** The account has only
   `guardian-telegram` (`ircsuib7u5kxv79detk1f`), and the spec bans that name from any on-camera
   surface because it reads as Dami's own product. Setup: BotFather `/newbot`, message the bot
   once, read the chat id from `api.telegram.org/bot<token>/getUpdates`, then KeeperHub
   Settings > Organization > Connections. The integration stores only `botToken`; `chatId` is a
   per-message input.
2. **`TELEGRAM_CHAT_ID`** for that integration.
3. **`KEEPERHUB_WEBHOOK_KEY`** (`wfb_...`), from Settings > Developer > API keys > Webhook keys.
4. **Base ETH in `0xDfcF22C371aE8B03d61ff937acB11DC9FF007d98`**, roughly $10.

Worker secrets `ELFA_SIGNING_SECRET` and `KEEPERHUB_WEBHOOK_KEY` are still unset on the deployed
Worker, and `BRIDGE_ENABLED` is `"false"`. All deliberate.

## Hard stops

**Stop and ask before Task 7 and Task 11.** Both execute a real 0.002 ETH swap on Base mainnet.
Irreversible, money-moving, outside the worktree. Do not rule through them.

**Never rename the Cloudflare workers.dev subdomain.** `meanwhile-waittime` is account-wide and
shared with `meanwhile-proxy`, the Commons submission, which is live and in judging with
`ALLOWED_ORIGINS` pinned. Renaming would silently 403 it. If the name is a problem on camera, buy
a custom domain for this Worker instead.

**Deploys are Dami's.** `wrangler deploy` was blocked by the permission classifier once already.
Ask rather than retry.

## Task 7 will hit two known tripwires

- `workflow/workflow.test.ts` asserts the Telegram ids stay literal placeholders, and hard-codes
  the swap amount and the `4828900` floor. Task 7 legitimately changes all three. Those tests
  will fail, correctly. **Re-pin them to the new values. Never loosen them back to relative
  comparisons** — that is exactly the weakness the round-2 and round-3 fixes closed.
- `action-schemas.fixture.json` is hand-built. Its action names were verified against the live
  API, but its field shapes were not.

## Commands that actually work

- **`pnpm` is not installed on this machine.** Use `npx`.
- Full suite: `npx vitest run` from the repo root. Expect 132 passing across 6 files.
- Typecheck: `npx tsc --noEmit` reports 49 errors, **all in `worker/test/*.ts`, none in
  `worker/src/`**. Cause is the `cloudflare:test` ProvidedEnv wiring, a Task 1 scaffold gap.
  Three fixes were attempted and abandoned rather than rabbit-hole; wrangler now wants
  `@cloudflare/workers-types` dropped for generated runtime types, which is bigger than it is
  worth mid-build. Queued as a separate chore. It does not gate anything.
- Toolchain deviates from the plan's pins and this is settled: vitest 4.1.11,
  `@cloudflare/vitest-pool-workers` 0.22.0, `cloudflareTest()` plugin rather than
  `defineWorkersConfig`, `compatibility_date = "2026-08-22"`. Do not "fix" these.

## Deferred minors

Roughly a dozen, all in the ledger, each with a ruling. The ones most worth a final review's
attention:

- `countStripPasses` duplicates `sanitize`'s loop in production source and can drift.
- `rejectedUnsigned` and `failedPersists` are per-isolate in memory, so `/health` shows a
  fraction of real traffic as if it were global.
- An unparseable or array `ROUTES` reports `routes:0, malformedRoutes:0`, so total config
  breakage stays undiagnosable.
- Task 5's bounded-`queryId` regression test does not discriminate; it re-proves an earlier fix.

## Related work, do not confuse

- `~/Desktop/keeperhub` holds the **bounty** PRs. Different repo, different BUIDL, submitted.
- `docs/architecture.html` is a published diagram page explaining the build. Republish the same
  file path to update it; a different path creates a second artifact.
- Dami's standing rules that bind here: plain language first, adversarial review by default,
  problem first in every README and submission answer, and every published LayerZero number goes
  through `/lz-dune-verify` with a query id and run date.
