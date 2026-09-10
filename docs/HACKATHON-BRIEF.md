# Agent Economy hackathon brief (verbatim)

Captured 2026-09-10 from the organisers' published brief plus two Discord clarifications.
Kept verbatim because the rubric wording decides how the submission is written. Do not paraphrase
this file; quote it.

## The theme, in their words

KeeperHub executes: deterministically, on demand, with full control and an auditable record.

Agents are probabilistic by design. Onchain value transfer does not forgive that. Ask an agent to
move funds and it reinterprets what you meant, at the moment it matters most, every single time.
KeeperHub removes the reinterpretation: your agent composes a workflow through our MCP server, you
review it, you dry run it without touching the chain, and then that exact workflow executes.
Nothing is inferred at execution time.

Underneath sits seven years of production infrastructure handling what an agent should never have
to: nonce management for stuck transactions, Smart Gas Estimation, private routing against MEV,
retries with exponential backoff, non-custodial wallets through Turnkey, and a full audit trail of
every run. Open source, SLA-backed, 20+ protocols across 20+ networks.

This is the second hackathon they are organising via DoraHacks. At Agents Onchain, which ran
through July and August, 471 builders registered, 190 projects were submitted, and every one was
reviewed at repository level. This time the brief is tighter. They are asking for integrations:
agents and workflows that connect KeeperHub into other live projects and move value through them.
Live means a project that exists and is running, with users, a deployed product or an active
protocol behind it. They would rather see one working integration into a project like that than
another standalone demo.

## What to build

One main track plus a bounty. Build the best integration of KeeperHub into a live project. Take a
live project of that kind and make KeeperHub the execution layer inside or alongside it.
Wayfinder, Daydreams and Almanak are named as examples worth exploring, and they are examples
rather than a shortlist: any live project qualifies. What matters is that the integration works
against the actual project, not a generic wrapper around it. The submission should show KeeperHub
executing value movement that the other project triggers, consumes or benefits from, with some
proof to back it.

## Prizes

$5,000 total, paid in stablecoins.

- **Main track: Best Integration into a Live Project, $4,000, ranked.** First $2,000, second
  $1,200, third $800. All submissions judged in one ranking.
- **Bounty: Best KeeperHub Feature, $1,000, two winners at $500 each.** Ship a feature as a pull
  request to the KeeperHub repository. Examples: a new chain integration, a new node, a new
  trigger or action, a connector, a developer experience improvement. Judged on whether they can
  merge it and build on it. Stacks with the main track.

A BUIDL can only be applied to one track. Entering both needs two separate BUIDLs.

## Timeline

- Build phase: Sep 6 to Sep 18. Office hours three times in the window at 12:00 CEST.
- **Submissions close Sep 18, 12:00 CEST. Nothing is accepted after this.**
- Judging Sep 18 to 25. Every submission reviewed at repository level, not just on form answers.
- **Live finalist panel inside the judging window.** Up to ten finalists present to judges on a
  call, split across two parallel rooms. Their words: "This is the part worth planning for.
  Written submissions reward good writing, and a live pitch with questions is where a strong field
  pulls apart. If you are shortlisted, you present the working build rather than slides, and you
  get asked about it, so build something you can run in front of people." Finalists invited by
  email ahead of the call.
- Winners announced Sep 24/25. Payouts in stablecoins after winners confirm details.

## Judging criteria

### Main track rubric

1. **Integration depth.** Is there a real, named project on the other side, and is the integration
   specific to it?
2. **Execution through KeeperHub.** Did value actually move through KeeperHub, and can we see it?
3. **Reliability and observability.** Does the build survive conditions that are not the happy
   path?
4. **Usefulness and originality.** Does it solve something real for users of the integrated
   project?
5. **Developer experience and code quality.** Could another team pick this up?

### Bounty rubric

Mergeability. Value to the platform. Code quality and tests. Scope and completeness.

## Submission requirements

Three things: a source code link, a short demo video showing the integration working, and a link
to a transaction executed through KeeperHub. **Incomplete submissions cannot be judged.**

Form questions:

- Which project did you integrate with, and what does the integration do?
- Which KeeperHub surfaces did you use (MCP, CLI, x402, MPP, agent-authored workflows, audit
  trail)?
- Testnet or mainnet?
- What still breaks or is unfinished? "A candid answer here has never hurt a submission."
- A reachable contact: email plus an X or Discord handle.

## Discord clarifications, 2026-09-10

On the demo video for a pull-request submission:

> for a PR it isn't a product demo. 60 to 90 seconds showing the feature actually running is
> enough: tests passing, your node or trigger executing inside a workflow, whatever proves the
> code does what the PR says. Screen capture, no voiceover needed.

On the transaction link:

> for transaction link, that is only if your feature has an onchain surface

The second answer was given about the bounty PR. **Whether a read-mostly protocol integration
needs a transaction link was asked and not yet answered.** The main track plainly needs one, since
criterion 2 is whether value actually moved.

## What this means for this build

Criterion 3, surviving conditions that are not the happy path, is where this bridge is strongest:
the refusal ladder, the public audit page, the idempotency key, the kill switch, and the
adversarial-review findings all serve it. Lead with it.

Criterion 1 wants a real named project. Elfa Auto is live and paid, and the integration exists
specifically because Elfa removed order execution and told users to build their own runner. That
is the opposite of a generic wrapper.

The finalist panel is worth optimising for. Dami places when he pitches live rather than cold, so
reaching the top ten matters more than polishing prose.
