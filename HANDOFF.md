# Handoff

Written at the end of a long session so the next one starts oriented instead of
rediscovering. Read this, then `CLAUDE.md`, then `SPEC.md` if you are changing
behavior.

`CLAUDE.md` holds the engineering rules and why each exists. This file holds
everything else: how the owner works, what the app is for, where we actually
are, and the four open bugs with their diagnosis already done.

State at the time of writing: `main` at PR #17, 332 tests, schema v10. Every
change this session is merged and built; section 4 says what has been seen
on a phone and what has not.

---

## 1. Hard constraints

**Never use the owner's work email on this project.** Not in a commit, not in a
config, not anywhere. This repository is **public**. The repo-local
`git config user.email` is already set to the correct personal address; leave it
alone and never override it with `--global` values or a `-c` flag. If you find
yourself about to write an email address anywhere, stop and check which one.

**Never seed, fixture, or demo a fabricated factual claim.** This has misled the
owner once already, in a way that cost real debugging time: the seed asserted a
World Series winner for a season that had not been played, on `example.com` URLs
dressed in AP and Reuters names, with `fetchStatus: 'ok'` hardcoded so the app
reported a quote verified on pages it had never opened. A "Sample" badge is the
backstop, not the fix. If a fixture states a fact, verify it against live
sources first and say in the commit that you did.

**Every check costs real money.** There is a paid Gemini key behind this with a
hard **$25/month** cap. Nothing may spend a check without a deliberate tap.
`runPull` has exactly one caller. No timers, no launch effects, no background
services, no "just re-run it to see." If you need to test the pipeline, use
`MockVerifier` or the unit tests.

---

## 2. How the owner works

The process rules live in `CLAUDE.md` under "How we work", and they are the
half of this that is enforceable. What follows is the style and the shape of
the collaboration, which is not.

Stated preferences, honored throughout this session:

- **Conclusion first, then reasoning.** For any decision or analysis, lead with
  the recommendation. Do not lay out equal options and leave the choice open
  unless the tradeoff genuinely depends on something you do not know.
- **Push back.** When the logic is weak or a tradeoff is being ignored, say so.
  Do not default to agreement. If you lack the information to assess something,
  say that instead of hedging.
- **No preamble, no wrap-up, no flattery.** Do not open with "So," or "Great
  question." Do not close with a summary restatement or an offer to help
  further.
- **Prose over bullets.** Short paragraphs. Structure only when items are truly
  discrete. Match length to the task: brief for execution, detailed for
  decisions.
- **Warn before a usage spike.** Before running anything that fans out into
  many agents or long autonomous passes (`/code-review max`, workflows,
  `ultra` anything), say what it will cost in rough terms and let the owner
  decide. A `/code-review max` on 2026-09-13 spawned ten agents and hit the
  session cap inside a minute; nine of them died before reporting. Light
  review by hand is the default; the heavy version needs a yes.
- **No em dashes.** American English, US dollars, imperial units.
- Banned words: actually, certainly, absolutely, of course, it's worth noting,
  that being said, needless to say, to be clear, at the end of the day, dive
  into, delve, unlock, leverage, seamless, game-changer, robust, comprehensive,
  cutting-edge, transformative, innovative, in today's fast-paced world.

How the work actually goes:

- The owner gives long autonomous stretches: "focus on iterative improvements
  and running small checks on what you can" and "I'm gonna leave it up to you to
  prioritize." Take that seriously. Work in small verified steps, commit each
  one with a real explanation, keep the tests green.
- **Merge your own pull requests.** Standing rule from the owner, given on
  2026-09-13: open the pull request, verify (tests, typecheck, build), merge
  it yourself, and tell the owner the APK is on its way with the list of what
  to look at. The owner does not want to be the click between a green branch
  and a build. Still write the "after installing" list; that is the part
  they use. Pushing straight to `main` is not the rule; the pull request is
  the record.
- **Before anything substantial, give a short brief proposal and wait.** The
  owner has asked for this by name more than once. A paragraph or two on what
  you would change and why, not a plan document.
- The owner does not want to do UI work themselves, so UI improvements are
  welcome and do not need permission the way behavior changes do.
- **The test loop is: you build, the owner installs the APK and sends
  screenshots, you read them.** This is the only way real Gemini behavior gets
  observed. Respect it. Batch changes so one build answers several questions,
  and say plainly what you want them to look at.
- The owner is newer to Claude Code. Explain tooling decisions when they matter
  and do not assume familiarity with harness mechanics.

---

## 3. What the app is, and the reasoning behind it

Mark My Words records declarative predictions ("mark my words, X by Y") and
fact-checks them against real sources over time. React 19, TypeScript, Vite,
Tailwind 4, Capacitor 8, shipped as an Android APK. SQLite via sql.js behind a
driver port.

The design decisions that took the longest to reach, and should not be quietly
reversed:

**The verdict decides. There is no score.** Gemini makes the determination.
The app's job is to notice when the citations do not hold up, not to
second-guess the answer. For weeks the app was getting correct answers from the
model and refusing to act on them because a composite evidence score had not
cleared 95. It was demoted to information on the check log, and then, in the
review that opened this session, removed: it was computed from the same inputs
the gates read, decided nothing, and printed two structurally wrong numbers on
correct checks. Two things stand between a verdict and the record: a gate
(something the app actively noticed was wrong with the citations) and the model
saying it is unsure (confidence under 70). Both queue the verdict for the owner.

**Source verification is a link check.** The owner challenged the layer
directly: "can you explain exactly why we think the app needs to verify the
sources at all?" The answer that survived a session: a model that invents a
plausible URL is the failure mode worth catching, and nothing else in the
pipeline can catch it. The answer that survived the review: an invented URL is
caught by the fetch, not by matching the page text, and the matcher could not
tell a rewritten page from an invented one by its own admission. The app now
opens each link and records whether it answered. It does not read the page.
The owner's words for the display: a green check if you can tap it and land
somewhere, a yellow mark if you cannot.

**A gate fires on "nothing here works," never on "one thing does not."** This
shape has been wrong three separate times: one dead link gated the check, one
stale quote gated it, one source older than the prediction gated it. Each time a
correct verdict carried by the other sources was blocked by one bad citation
among them. If you add a gate, gate on the whole set.

**The standard of proof is civil, not criminal.** The check prompt asks for the
balance of the evidence and applies an adversary test: "would the person who
made this prediction have grounds to object to how you settled it?" This came
from the owner, who asked whether Gemini could be told to judge sources the way
a reasonable person would, as evidence would be examined in court. It worked.

**Place is pinned as tightly as the number.** A reading from a station seventy
miles away is a different place. A regional airport is not the town. This came
from a real failure where a Sea-Tac reading was nearly used to settle an
Anacortes claim.

**Search is the billed unit, and it is capped by instruction.** Gemini charges
per search query on a grounded call, not per prompt. The check prompt tells the
model to stop at three agreeing sources and never exceed twelve searches. Both
are unenforceable by prompt alone, which is why recording the real count matters
(see bug 4, which is that the recording does not work yet).

---

## 4. Where we actually are

Thirty-nine pull requests have landed on `main` since 2026-09-12, all built
and most verified on the owner's phone; the last twenty-two (PRs #18 to #39,
2026-09-13 and the small hours of the 14th) came from one long session that
compacted more than once. The pipeline is correct on every seeded fixture,
including six adversarial ones added on the 13th, and on the first hand-typed
and shared claims. What follows is the state, not the history; the history is
in `git log`, one explanation per commit.

**What the long session added, in the order it mattered.** The share sheet
works (the app's own `ShareIntentPlugin`; twelve screenshots reached the
capture screen) and the model reads a screenshot for the words, the handle
and the date, with the picture kept as the source; the capture screen says
when no date was read and the review card redrafts from a changed date and
will not confirm until it has. Builds install over each other (checked-in
debug keystore). Checks keep running across screens (`PullProvider`). The
feed has a press-and-hold menu (open, pin, amend, delete with confirmation),
an order sheet, and a status strip with the topic on its own pinned chip that
combines with the status. Records are colour-coded, the check log collapses
old entries, everything that generates shows motion, the stamps are slanted
and heavier, the ground is darker, and the icon is centred on its dial.
Intake gained three rules from ten typed statements and the extractor gained
six from twelve shares; all of those are prompt-level and only the phone can
test them.

**The pipeline, as it runs today.** Intake asks the model for criteria that
carry every narrowing word, a deadline shape, a disconfirming trigger for
negative claims, `can_happen_late`, and questions for the person where it
could not decide. The review card shows the questions as a list and redrafts
everything below the statement when the wording or the date is changed and
the field is left; the date is what the model reads the claim as of, and a
changed date blocks confirming until the redraft has run. A check asks the model for a verdict against the frozen criteria, with
the period stated explicitly from the recorded date to the deadline. The app
opens every cited link (`ok`, `blocked`, `missing`, `unreachable`), judges
tier and independence from the domain, and applies the verdict unless a gate
fires or the model reports confidence under 70; either queues it for the
owner. No score. A negative claim past its deadline with nothing found queues
a hit. A late-watch re-check that confirms the miss records and changes
nothing. Criterion marks follow the verdict, whether a check or a person
called it; nothing on screen sets them by hand.

**Verified on device, in order:** the criterion index fix (both Super Bowl
criteria ticked); the score gone; the link check (green check, "page not
found", "site not found"); Anacortes settling itself after the day-versus-
instant fix; the Custom Tab (no more download prompt); "Not right? Reopen
it"; six live fixtures on one pull (hit, hit, hit, partial queued, negative
hit queued, no_change); the negative path; the Dodgers sample replaced by a
real hit; the tokens line and no sample spend in Settings; "It happened
anyway" gone from dated claims; the build label in Settings matching the
release title; the corrected drone seed reading no_change; a hand-typed
intake keeping "release" as a question; Settle it on a you-decide bet with
the mark following the verdict; the redraft affordance; the six adversarial
fixtures (Eagles no_change, Bitcoin miss, 60 home runs miss with Raleigh,
Hurts split with two ticks, Artemis miss then late watch, Starship miss);
the hold menu opening on release; pin to top; the screenshot share path on
twelve posts; the "2y" hint and the no-date note; the review card refusing a
2025 deadline on a claim dated today.

**The one wrong verdict, and what it taught.** The rogue-drone seed settled as
a hit on a July strike reported in August, on criteria that had softened
"rogue" to "autonomous". Two rules came out of it and are in CLAUDE.md: the
period starts on the recorded date and only the model can check event dates;
and qualifiers must survive into the criteria. The owner caught both from the
screenshots. Nothing in the pipeline can check when an event happened; the
review card is the only place a person can catch a dropped word.

**Not yet verified on device:** the review card redrafting from a changed
date and blocking confirm until it has (PR #37); the per-share form reset,
the text cleaning and the raw-response line in Settings (PR #38); the topic
chip (PR #39, checked in a browser at phone width only); the second-run
extraction rules (Reddit cues, "...more", reported predictions); the X and
Reddit link path, which the container cannot reach at all; the criterion
mark being read-only on a you-decide bet (PR #14, owner confirmed the Settle
flow but not the tap); the Standings screen and the receipt share on a
device (the receipt's fonts were fixed from a browser render, PR #21).

**Install drill.** Install over the previous APK (every build from f255f7f on
is signed with the checked-in debug key, so data and the API key survive), wipe
data in Settings if the seed changed, one pull.
Settings ends with an "Installed build:" line; the release page title carries
the same words and time. If they match, the phone is on the latest build.

## 5. The open bugs

Of the four diagnosed last session: **bug 1 is fixed** (commit 2 above). **Bugs 2
and 3 are moot**, since the matcher and the score they lived in are gone.
**Bug 4 is instrumented and half-diagnosed.** The first real diagnostic showed
`groundingMetadata` absent from the candidate outright, on a check whose
citations carried a Weather Underground reading for the previous day, which the
model could only have searched for. So the search happens and the API reports
nothing about it. Two candidate causes, not yet told apart: the
`gemini-flash-latest` alias resolves to a model generation whose API reports
grounding differently (the diagnostic now prints `modelVersion`), or Google
attaches grounding metadata only when it can tie citations to sentences in the
answer, and a JSON-blob answer gives it nothing to tie to. If it is the second,
the pricing page's "billed only when a grounding support is returned" would
mean these checks are not billed for search at all; that is a hypothesis from
a secondary page, not a verified fact. Fastest way to settle it:
`GEMINI_API_KEY=... node scripts/validate-gemini.mjs` on the owner's desktop
prints the model version and shape and saves the raw response beside itself.
The build container cannot reach Google.

Still open, smaller:

- **The screenshot extractor drops dates.** The share sheet itself works
  (rebuilt 2026-09-14 with the app's own `ShareIntentPlugin`; five device
  shares reached the capture screen the same evening). What those five
  showed: the date came back empty every time, twice with a dateline on
  screen, and the form filled in today without saying so. The statement date
  sets the period start, so a two-year-old Reddit post recorded as said
  today is a different claim. Prompt rules added for datelines, partial
  dates and relative ages, a `posted_hint` field carries what was shown, and
  the capture screen now says when the date defaulted. Also added: reported
  predictions belong to the person credited (a Yahoo piece on Kyle Brandt's
  pick came back with no author), and a forum member name counts as the
  author. The second device run (seven Reddit shares, same evening) showed
  the "2y" hint and the no-date note both working, the review card refusing
  a 2025 deadline on a claim dated today, and three new faults: a share
  landing on an already-open capture screen kept the previous post's author
  (fixed: the form resets per share), a statement came back with "002" and
  a foreign glyph stuck to its last word (the parser now strips controls and
  decodes stray escapes, and Settings keeps the model's raw response for the
  next one), and "...more" was copied as if it were the post's words (prompt
  rule). The model still misses the u/name and the age on some Reddit posts;
  the prompt names both cues now. The Settings "Last share received" line
  and the raw response under it are the diagnostics.
- **Pricing unit is unverified.** From secondary pages (the official docs are
  blocked from the build container): the 2.5 family bills grounding per prompt,
  the 3.x family per search query, with a free allowance on both that this
  app's volume sits inside. Which one `gemini-flash-latest` resolves to decides
  what the searches-this-month number in Settings means. Check the billing page.
- **`priorFindings` feeds the last two summaries back to the model.** A wrong
  summary anchors the next check. Nothing tests what happens when the memory
  is wrong.
- **The "Held:" label** in the check log now mostly means "a late-watch
  re-check confirmed the miss". Rows from before this session that read Held
  meant "held for thin evidence". The label is true of both, so it stayed.
- **Freeze at confirm** was decided on 2026-09-13 and built (PR #19). The
  detail screen's "Editable until first check" pill is now "Not yet frozen"
  and should be unreachable for anything confirmed by the app.

---

## 6. Proposed and deliberately not built

**The observation path.** Give criteria a structured `observable` (threshold,
unit, comparator) so the app does the numeric comparison itself. The review
evaluated it and recommended against, and the owner agreed. The reasons: the
spec's own example claims (the Cardinals, the AI bubble, Thor's arm, the
gutters, Bitcoin, the Eagles) are almost none of them structured-data claims;
weather is the flagship fixture because it is cheap to test, not because it is
representative. The path would need a per-domain adapter, a geocoder (the
place problem moves into the new layer rather than leaving), and a step that
turns "85F within 25 miles of Anacortes" into a source-field-comparator tuple,
which is itself a model call. The instrument it would replace has been right on
every real verdict. What would reopen the question: a wrong verdict on a
numeric claim. None has happened.

---

## 7. What has been tried

Prompt changes, with results, so nobody re-runs a failed experiment:

- **Anchoring the confidence bands worked.** Giving explicit meanings to 90-100,
  70-89, 40-69 and below-40, plus telling the model that disagreement between
  sources only lowers confidence if it could change the verdict, took a check
  from 35 to 98. Confidence has been 98 on every check since.
- **"Cite pages that will still say this tomorrow" did nothing measurable.** The
  model still cites live pages. The rule is kept, softened, for the reader's
  sake rather than the app's.
- **Explaining what `basis` means fixed a real failure**, and `basis` has since
  been removed along with the coverage line it fed. If criteria-level evidence
  matters again, `why` is still returned per criterion.
- **Telling the model search costs the owner money, personally, is still
  untested**, because bug 4 means nothing is measuring it.

Errors made across sessions, recorded so they are not repeated:

- I blamed the drafting model for a date that my own seed code had written, and
  said so publicly before catching it. Check your own code before attributing a
  bug to the model.
- I seeded a fabricated Cardinals World Series result that the owner believed
  and reasoned from. Then I badged it "Sample" and left the false content in,
  which was the weaker half of the fix. The owner had to tell me to replace it.
- I misread "limit how many sources Gemini would **check**" as "cite" and pushed
  back on the wrong thing.
- I guessed the `groundingMetadata` response shape from memory. It did not work.
- The late-watch crash was sitting behind a comment that described exactly that
  failure and guarded only the other branch. When a guard exists, test the
  case it names on every path that reaches it.

---

## 8. Operating notes

- **Build loop.** Merge to `main` (your own pull request; see section 2),
  GitHub Actions runs types, tests, then builds a debug APK and replaces the
  rolling `latest` release. There is no `gh` CLI in
  the container; use `curl` against the API with `$GH_TOKEN`, or the GitHub
  MCP tools where the session has them. Poll with an until-loop in a
  background Bash call rather than chained sleeps.
- **Every APK is signed with `android/debug.keystore`**, checked in, so a new
  build installs over the old one and keeps the database and the saved key.
  Before f255f7f (2026-09-13 12:52 UTC) each build had a throwaway key and
  every install was an uninstall first, which is why the key had to be pasted every time. The
  owner asked for a "use test key" checkbox with the key hardcoded instead;
  the repo is public, so that was declined and this is the fix. The one
  remaining uninstall is the move from the last throwaway build to the first
  stable one.
- **The seed only writes to an empty database.** New fixtures require wiping data
  in Settings. Say this every time too.
- **Screen sweep:** `CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
  node scripts/ui-audit.mjs` against a dev server on 5173. The default Playwright
  browser path in the container is wrong; pass `CHROMIUM`.
- **For a one-off screenshot,** write the script into the repo root and delete it
  after. Playwright will not resolve from the scratchpad directory.
- **Outbound `curl` to news and weather hosts is blocked** by the container's
  egress policy, and so is `ai.google.dev`. `WebSearch` works; `WebFetch` works
  on some hosts. Real page behavior can only be observed through the owner's
  phone.
- **`npm ci` first.** The container starts without `node_modules`, and vitest
  fails with a config error that looks like a Tailwind problem until it is
  installed.
- **The two live test fixtures** are documented in `CLAUDE.md`. They are chosen
  to be opposites: a numeric threshold pinned to a locality against a .gov
  page, versus two discrete facts with no geography against static recaps.
  Running one pull settles both.

---

## 9. The load-bearing assumptions, and what the review made of them

Each of these was stated last session as something to attack. The review did,
the owner decided, and the branch reflects the decisions. Recorded here so the
next session does not re-litigate them without new evidence.

1. **A language model with web search is the right instrument.** Holds, for the
   claims this app is for. See section 6 for why the alternative was declined
   and what would reopen it. One weakness nobody had named: the app cannot
   tell a grounded verdict from a recalled one, and the only signal that would
   (the search count) is the one that does not work yet. That is what bug 4 is
   for.

2. **The app should verify citations rather than the claim.** Reduced to what
   earns its keep. The fetch stays: reachability feeds a gate, and the redirect
   it follows feeds the tier and independence gates. The text matching went.

3. **The rubric should exist.** No. Removed.

4. **Gates and the score as separate mechanisms.** The asymmetry was the right
   end state; the dead half is gone. One gate was wrong by the codebase's own
   rule and was narrowed (publisher mismatch).

5. **Cost control belongs in the prompt.** The prompt ceiling is unenforceable
   and stays as a hint. What actually bounds spend: the tap gate, the budget of
   six per pull, the daily cap in Settings (default 20), and Google's $25 hard
   stop. At this app's volume grounding is inside the free allowance on either
   billing model. Stop spending sessions on the prompt for cost; spend one on
   verifying the billing unit.

6. **Criteria frozen at confirm, amendable with an audit trail.** Holds.
   Moved from first-check to confirm on the owner's decision (section 5).

7. **Quoted-text matching in any form.** No. Removed. The quote is still
   requested and shown, as the citation, for a person to read.
