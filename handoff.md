# Handoff

## Current state, 2026-09-10 03:42 WAT

This section supersedes the historical status below.

- Tasks 1–10 are complete. Task 12's README, storyboard, and adversarial review are complete.
  Task 11 remains blocked only on the operator deployment and live Elfa→Worker evidence.
- Branch: `feat/bridge-implementation`. Latest commits:
  - `bb69316 test: type Worker health response`
  - `9ef59e6 docs: problem-first README and video storyboard`
  - `9fc7042 fix: refuse malformed query ids safely`
  - `246087c feat: fire status and scoped teardown commands`
- Quality gates: 162/162 tests pass; `npx tsc --noEmit` passes; tracked-secret scan is clean;
  `npm audit --omit=dev` reports zero production vulnerabilities.
- Mainnet proof is finished. KeeperHub execution `cgxl31n4l3sns4zy15pqc` swapped 0.002 ETH
  into 4.922114 USDC on Base in transaction
  `0x79ab494c3f0f65c63986c1410a503e0167c94f3175492e263b81035e8eac10cd`. Do not spend again
  without separate explicit authorization.
- The post-swap wallet balance is 0.000925144547693724 ETH. A later KeeperHub execution,
  `enykq0mq4ejhy1055wbm4`, proved the balance refusal and produced no transaction.
- The local Worker is version 1.0.0, but the public URL still serves version 0.1.0 with
  `enabled=false`, `routes=0`, and no `/audit` route.
- `npx wrangler whoami` confirms Dami's Cloudflare login and Worker/KV write permissions.
  `npx wrangler secret list` returns `[]`: the two remote Worker secrets are still absent.
- Deploys remain Dami's operator action. The exact next sequence is:

  ```bash
  npx wrangler secret put ELFA_SIGNING_SECRET
  npx wrangler secret put KEEPERHUB_WEBHOOK_KEY
  npx wrangler deploy
  npm run bridge -- setup --film --threshold 78250
  npm run bridge -- status
  ```

  The threshold was chosen from a read-only Hyperliquid BTC mid of 78223.5 and is time-sensitive;
  recheck spot if the command is not run immediately. `setup` creates an Elfa plan, writes its
  route, enables the bridge, and deploys again.
- After deployment, use `bridge fire` to record valid, duplicate, stale, forged, and unrouted
  decisions. Because the wallet sits below the 0.0025 ETH guard, a valid forward will stop in
  KeeperHub without another transaction.
- `README.md` and `video/STORYBOARD.md` are ready. Both clearly distinguish the direct KeeperHub
  mainnet proof from the still-missing live Elfa→Worker path.
- The KeeperHub credentials and Telegram bot token were shared in chat. They are not tracked by
  Git, but rotate them before final public launch and update Cloudflare plus the KeeperHub
  Telegram integration with the replacements.
- `docs/architecture.html` remains an untracked user-owned file. Do not add or modify it without
  Dami's direction.

---

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

---

## Where to look things up

Everything below was used to build this and should be consulted before asserting anything.

### In this repo

| Path | What it is |
|---|---|
| `docs/HACKATHON-BRIEF.md` | The organisers' brief and rubric, **verbatim**, plus two Discord clarifications. Quote it, do not paraphrase. |
| `docs/WHAT-WE-ARE-BUILDING.md` | Plain-language explanation. Start here for the pitch, the README and the finalist call. |
| `docs/FACTS.md` | Every published number with its source and verification date. **A fact with no row here does not ship.** |
| `docs/architecture.html` | Published diagram page. Live at https://claude.ai/code/artifact/37e7b54a-61fd-449f-9f15-04801a059344 . Republish the same file path to update; a different path creates a second artifact. |
| `docs/superpowers/specs/2026-09-06-elfa-keeperhub-bridge-design.md` | Spec rev 2. **The binding authority.** Conflicts in the plan resolve against it. |
| `docs/superpowers/plans/2026-09-07-elfa-keeperhub-bridge.md` | The 12 tasks. |
| `.superpowers/sdd/2026-09-07-elfa-keeperhub-bridge/progress.md` | The ledger. Git-ignored. 18 rulings, every completed task, every deferred minor. |
| `.env` | Git-ignored. Nine of eleven credentials populated and verified live. |

### Outside this repo

| Path | What it is |
|---|---|
| `~/Desktop/keeperhub` | **KeeperHub's own source, checked out.** The authoritative answer to any question about KeeperHub behaviour: plugin field requirements, protocol definitions, test harness shape, CI workflows. Read it rather than guessing. Also holds the bounty PR branch. |
| `~/Desktop/keeperhub/docs/plugins/` | KeeperHub's own plugin docs, including `telegram.md` and `layerzero.md`. |
| `~/Documents/Knowledge base/keeperhub bounty/BUIDL-BOUNTY-SUBMISSION.md` | The submitted bounty BUIDL copy. Different track, different BUIDL. |
| `~/Documents/Knowledge base/keeperhub bounty/_buidl-fields.txt` | Character-counted form fields, all under the 960 limit. |
| `~/Documents/Knowledge base/hackathons/SCHEDULE.md` | **Standing rule: the one hackathon schedule.** Update it at the end of every hackathon-touching session. |

### Live sources, and what they answered

| Source | Use it for |
|---|---|
| KeeperHub MCP `list_action_schemas` | Action-type names. **Needs no auth.** Output is large; it saves to a file, so grep it rather than reading it. Confirmed all six workflow action types exist. |
| KeeperHub MCP `search_protocol_actions` | Protocol actions, which are **not** in the top-level action list. Query `ccip` returns 9, `layerzero` returns 0. A naive grep of the schema list returns 0 for both, because the namespace is `chainlink/ccip-*`. |
| KeeperHub REST, `Authorization: Bearer $KEEPERHUB_API_KEY` | `/api/workflows` 200, `/api/integrations` 200, `/api/projects` 200. `/api/v1/workflows` and `/api/executions` are 404. Spending limits not found under four guessed paths. |
| Elfa REST, header `x-elfa-api-key` | `GET /v2/auto/queries` 200. `POST /v2/auto/queries/validate` is free and creates nothing: use it to check a plan shape before spending credits. |
| Telegram Bot API | `getMe` verifies a token, `getUpdates` yields the chat id, `getWebhookInfo` diagnoses why `getUpdates` is empty. `pending_update_count: 0` means the messages went to a different bot. |
| Dune query **8659763**, execution `01M244QTJDYA14ZVE1BG08GWNK` | LayerZero all-time totals. Derived from LayerZero's own Stats query **5202883**. This Dune plan caps executions at 2 minutes and offers neither `medium` nor `large` for the LayerZero dataset, so the original times out and had to be rewritten lean. |
| `@elfa_ai` on X | https://x.com/elfa_ai/status/2094726966264070642 . The August usage stat. **Wording is still Dami's paraphrase; confirm verbatim before publishing.** |

### Skills that must be used, not optional

| When | Skill |
|---|---|
| Any published LayerZero or Dune number | `/lz-dune-verify`. Never raw `mcp__dune__*`, never hand-rolled SQL. Cite query id and run date. |
| Any claim about LayerZero mechanism | The `layerzero-docs` MCP is the source of truth. Query it before asserting. |
| Any prose that ships | `/stop-slop`. No em dashes, active voice, no adverbs. |
| Resuming the build | `superpowers:subagent-driven-development`. Sonnet implements, Opus reviews. |
| Before a design or placement decision | Ask with concrete options rather than picking silently. |

### Two things that are not written down anywhere

- Whether a read-mostly PR needs a transaction link for the **bounty**. Asked in Discord, unanswered.
- The KeeperHub spending-limits REST path. The MCP tool for it returns 401 without auth and the
  four guessed REST paths 404. The spec's figure, `effectiveDailyCapWei = 5500000000000000`
  (0.0055 ETH/day), came from a probe on 2026-09-07 and has not been re-verified since.

## Related work, do not confuse

- `~/Desktop/keeperhub` holds the **bounty** PRs. Different repo, different BUIDL, submitted.
- `docs/architecture.html` is a published diagram page explaining the build. Republish the same
  file path to update it; a different path creates a second artifact.
- Dami's standing rules that bind here: plain language first, adversarial review by default,
  problem first in every README and submission answer, and every published LayerZero number goes
  through `/lz-dune-verify` with a query id and run date.
