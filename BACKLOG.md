# Backlog

Ranked. A session takes the top item it can finish, or the one the owner names.
Requests that arrive mid-session are added here rather than into the session
(CLAUDE.md, "One job per session"). Each entry says why it is where it is.

1. **Intake eval, same shape as the extraction eval.** Raw statements with the
   fields a review card must get right: deadline type, the qualifiers that
   must survive into the criteria, the questions it should ask. Second half
   of the prompt eval job; starts once the extraction eval has run green in
   Actions on three confirmed screenshots. Expected values come from the
   owner in chat, never guessed.
2. **A tagged known-good release in CI alongside the rolling `latest`.** The
   rule is in CLAUDE.md ("Keep a known-good build to fall back to"); the
   workflow does not do it yet. Until then HANDOFF.md section 4 names the
   last good hash. Owner deferred it on 2026-09-14: "later, not now".
3. **Device checks HANDOFF section 4 lists as not yet verified.** The review
   card redraft on a changed date (PR #37), the per-share form reset and raw
   response line (PR #38), the topic chip (PR #39), the second-run extraction
   rules, the X and Reddit link path, the read-only criterion mark on a
   you-decide bet, Standings and the receipt share. Needs the owner's phone;
   batch them into one install. Deferred with item 2.
