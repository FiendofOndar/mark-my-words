# Backlog

Ranked. A session takes the top item it can finish, or the one the owner names.
Requests that arrive mid-session are added here rather than into the session
(CLAUDE.md, "One job per session"). Each entry says why it is where it is.

1. **Stop the model overriding an on-screen date with what it knows.** A
   tweet timestamped May 2, 2026 came back as 2022-05-02 on two runs,
   apparently because the account and the subject read as an earlier era.
   The date sets the period start, so this is a wrong-verdict bug waiting
   to happen. The fixture is committed (`reddit-nested-gas-prices.jpg`)
   with every field pinned, the date included: the owner confirmed the
   year on 2026-09-16, so that row is deliberately red and is the failing
   test to fix against. Do not unpin it to make the suite green.
2. **Intake eval: confirm the remaining fourteen cases.** The two rulings
   were made on 2026-09-18, the prompt carries them, and runs 16 and 17
   both came back 4 pass, 0 fail, 0 error, which meets the two-clean-runs
   bar for the four keys that grade. The fourteen other cases still hold
   only proposals: a session drafted them and the model agrees, which is
   not confirmation. One pass by the owner over the readings on issue #47
   moves them to `expect` and makes the suite worth failing on. Two of them
   have a known wobble described in HANDOFF section 8 and are the ones to
   read first. About 50 to 55k tokens a run.
3. **A tagged known-good release in CI alongside the rolling `latest`.** The
   rule is in CLAUDE.md ("Keep a known-good build to fall back to"); the
   workflow does not do it yet. Until then HANDOFF.md section 4 names the
   last good hash. Owner deferred it on 2026-09-14: "later, not now".
4. **Device checks HANDOFF section 4 lists as not yet verified.** The review
   card redraft on a changed date (PR #37), the per-share form reset and raw
   response line (PR #38), the topic chip (PR #39), the second-run extraction
   rules, the X and Reddit link path, the read-only criterion mark on a
   you-decide bet, Standings and the receipt share. Needs the owner's phone;
   batch them into one install. Deferred with item 2.
5. **A replay-fixture layer for the parsers.** The eval gets real Gemini
   responses in Actions and keeps the raw JSON only for failed rows. A
   record mode that saves every raw response under `evals/responses/`,
   plus parser tests that replay them, would test a parser change against
   real model output for free. Proposed 2026-09-16 alongside the property
   sweep, which stops at the domain layer because everything past it needs
   model output.
