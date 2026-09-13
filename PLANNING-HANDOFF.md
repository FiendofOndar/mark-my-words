# Planning-branch handoff

For the session continuing on `claude/app-scalability-monetization-shx9je`
after the model switch on 2026-09-13. Read `CLAUDE.md` (the "How we work"
rules and the owner's style), then `VIABILITY.md` sections 0 and 10, then
this. Delete this file when the branch merges; anything durable in it
belongs in `VIABILITY.md` or `HANDOFF.md`.

## What this branch is

Planning only. No app code changes. Three commits so far: the viability
plan, its rewrite around the owner's decisions, and the Apple findings.
`VIABILITY.md` is the deliverable; `scripts/cadence-model.mjs` is its one
script; `CLAUDE.md` gained a pointer. Push with
`git push -u origin claude/app-scalability-monetization-shx9je`. Do not
open a pull request unless the owner asks; the owner's standing rule about
merging your own PRs is for the main line of work, not this branch.

## Constraints that bite

- Never the owner's work email or anything Encompass-associated, anywhere.
  The container's git identity is `Claude <noreply@anthropic.com>`, which
  matches 87 earlier commits. Leave it.
- Label the basis of every number: file read, page fetched, snippet, memory.
  `VIABILITY.md` does this in every table; keep the habit.
- Owner's style: conclusion first, prose over bullets, no em dashes, no
  preamble, the banned-word list in `HANDOFF.md` section 2. Push back when
  the logic is weak. Propose briefly and wait before anything substantial.
- Most vendor sites are blocked from this container (Google Play help,
  RevenueCat, App Store pages, most pricing pages). developer.apple.com and
  GitHub raw content fetch fine. Say "snippet" when that is all you had.

## Decisions already made by the owner (do not re-open without evidence)

`VIABILITY.md` section 10: bring-your-own-key is primary; a keyless free
layer; a community pool capped at Google's free allowance; no subscription,
no ads, no paid download; one one-time supporter unlock around $4.99.

## In flight when the switch happened

1. **A research agent on Apple App Review risks for this design** was still
   running. Its result arrives in this conversation as a task notification.
   It covers: BYOK precedent and 3.1.3(f), Capacitor "web wrapper" risk
   under 4.2 and 2.5.6, 5.1.2(i) consent, 5.3 and the word "bet", IAP rules
   for a non-consumable, export compliance and privacy manifests, DPLA
   3.3.11. When it lands: fold sourced rows into `VIABILITY.md` 4.1a (Apple
   table), adjust 2.10 if it contradicts anything there, add unverifiable
   items to section 8, commit, push.
2. **The owner's question** ("is anything about the way we're doing this a
   hard blocker for the App Store?") has been answered only from the
   developer-side report so far, in `VIABILITY.md` 2.10 and 4.1a. Give the
   owner the complete answer once the second report is in. The shape of
   the answer so far:
   - No hard blocker in the design itself was found on the developer side.
   - The one thing that could stop the listing: being classified as
     "simulated gambling" on an individual account (2.10). Mitigation is
     vocabulary, honest age rating as Contests, and review notes.
   - Hoops with a privacy cost: legal name as public seller; EU trader
     status publishes an address, phone and email, or exclude the EU.
   - Hoops in time and paperwork: enrollment stalls reported in 2026 (start
     early), Paid Apps Agreement with W-9 and SSN before the unlock can
     ship, a Mac or a macOS CI runner.

## Open questions the owner has to answer (collect, do not decide)

- `stakes` field in the store build: keep, rename, or drop (2.10, 8.0d).
- EU: declare trader status or exclude the EU storefronts (8.0e).
- Whether to start the Apple enrollment now, given the reported delays.

## What is next on this branch after the Apple work

Nothing planned. The owner may ask for more research (Play-side equivalents
of 2.10, the Gemini free-tier grounding question in Stage 0, Google's API
terms on user keys). Stage 0 of the roadmap (`VIABILITY.md` section 5) is
the first real work and it is verification, not code: it needs a live free
Gemini key, which only the owner has.

## When the branch merges

- `HANDOFF.md` should point at `VIABILITY.md` section 10 for the business
  decisions and note that the repo-local git identity claim in its section
  1 is not true in a fresh container.
- `README.md` on `main` is stale in four places (`VIABILITY.md` section 1,
  "Stale record"). Fix it in the merge or right after.
- Delete this file.
