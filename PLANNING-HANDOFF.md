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

## State at the switch

Both Apple research reports (developer side, App Review risks) landed and
are folded into `VIABILITY.md`: section 2.10 (the gambling-classification
risk), 2.1 and 2.6 (BYOK wording, consent, labels, manifest), 4.1a (two
Apple tables), section 6 (pre-release checks), section 8 (items 0c to 0g).
No research agent is in flight. The owner has the complete Apple answer in
the chat; the durable version is `VIABILITY.md`.

## Open questions the owner has to answer

None at the switch. The three from the Apple work are decided
(`VIABILITY.md` section 10): stakes field relabelled (requested from the
main line as a GitHub issue), EU trader status yes, Apple enrollment starts
now.

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
