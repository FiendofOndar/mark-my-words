# Handoff

Written at the end of a long session so the next one starts oriented instead of
rediscovering. Read this, then `CLAUDE.md`, then `SPEC.md` if you are changing
behavior.

`CLAUDE.md` holds the engineering rules and why each exists. This file holds
everything else: how the owner works, what the app is for, where we actually
are, and the four open bugs with their diagnosis already done.

State at the time of writing: branch `claude/architecture-review-bugs-9ua5gc`, 320 tests,
schema v8. Not yet merged to `main`; see section 4.

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

The review the owner asked for at the start of this session is in the session
transcript; its conclusions are in section 9 below. The owner made five
decisions on it and every one is built, on the branch named at the top.
Nothing has been run against a real key since. **The next step is a build, and
the owner's screenshots.**

What the branch contains, one commit each, all with tests:

1. A crash fix. A late-watch re-check that returned "miss" threw on the
   miss-to-miss transition and ended the whole pull. Every miss got a
   three-year watch by default, so every miss became this thirty days after it
   settled. The pull loop also now files anything that escapes `runCheck` as a
   failed check row instead of dying.
2. Bug 1, the criterion index. The wire format is 1-based to match the prompt;
   a 0-based reply is still accepted.
3. The evidence score removed. `src/domain/rubric.ts` is `gates.ts`; checks
   store their gates as a JSON array in the renamed column; `basis` is gone
   from the criteria status. Bug 3 went with it.
4. The page matcher removed. `validateSources` opens the link and records
   `ok`, `blocked` or `unreachable`; old `facts_found` and `quote_not_found`
   rows migrate to `ok`. Bug 2 went with it.
5. Late watch defaults to `never` for dated claims, `3y` for event-shaped.
6. The publisher-mismatch gate fires only when nothing clean and reachable is
   left; otherwise the mismatch is printed on the row.
7. Negative claims: past the deadline, a check that finds nothing queues a hit
   for approval. The prompt tells the model never to return hit on one.
8. Bug 4 diagnostic: a grounded check with no `webSearchQueries` prints the
   response's keys and the raw `groundingMetadata` under "What the provider
   said" on the check log.
9. Cleanup: the unused `dailyQuota` on the verifier interface and its stale
   200-per-day constant; the intake rule steering local weather to manual;
   "Settled automatically" is now "Settled by the app".

Last real run, before any of this (three manual checks on the two live fixtures
plus the sample): Anacortes miss, settled; Super Bowl hit, settled; Dodgers hit,
held on the mismatch gate. All three verdicts were correct.

**First run on the merged branch (PR #2), from the owner's screenshots.** Both
Super Bowl criteria ticked (bug 1 fixed on a real run); one of its three links
dead and correctly not blocking. Anacortes: correct miss, model at 98, but
queued on "Every source predates the prediction". Diagnosis, confirmed in a
test: a bare "2026-09-12" parses as midnight UTC, the claim is stored as a
local end-of-day instant, so in Pacific a next-day source read as seven hours
before the claim. Fixed by comparing calendar days (PR #3). The "What the
provider said" panel showed `groundingMetadata: absent` with response keys
`candidates, usageMetadata, modelVersion, responseId`; see bug 4 below. The
owner also reported that tapping a source link made Chrome re-prompt the APK
download: a target=_blank anchor hands the URL to the user's own Chrome, which
restores its last tab, which was the release download. Links now open in a
Custom Tab (PR #3, unverified on device).

PR #3 was verified on device: Anacortes settled itself as a miss, the Reopen
link is there, and the provider panel names the model as `gemini-3.8-flash`
with `Parts: text+thoughtSignature` and `groundingMetadata: absent`. After it,
on the same branch: the criterion mark made read-only on searchable
predictions (it was a silent edit nothing read); `can_happen_late` asked at
intake and stored, replacing the deadline-type proxy for late watch and
gating the "it happened anyway" control; tokens spent shown in Settings,
labelled as not a bill.

The seed now carries six live fixtures instead of two (CLAUDE.md has the
table): Return of the King (hit), Oppenheimer at the 2024 Oscars (partial),
no crewed Moon landing before the end of 2025 (a negative claim, queued hit by
absence) and GTA VI before the end of 2026 (open, no_change). Thor's arm is
gone; the film has not come out. All four facts were verified by web search
before seeding. One pull now spends six grounded calls.

**Six-fixture run, verified on device (PR #4 build).** Return of the King:
hit, settled, both criteria ticked, one dead link marked and not blocking.
Oppenheimer: partial, queued, ticks correct. Moon landing: the negative path
ran for the first time and queued a hit with the right gate line. One check
(Return of the King) timed out at 45s on the pull and was correctly filed as
failed without consuming the slot; "Check now" then settled it. The timeout
is now 90s. Every provider panel again showed `groundingMetadata: absent` on
`gemini-3.8-flash`; the Oppenheimer candidate also carried a
`citationMetadata` key, which is the first time any citation structure has
appeared. The prose-answer experiment in the desktop script remains the
cheapest way to find out whether grounding metadata depends on the output
format.

**Owner-observed, PR #4 build:** re-running Return of the King with two of
three deep links returning 404 queued the verdict instead of settling it,
because a 404 counted the same as a non-existent host and left one non-primary
publisher. `missing` (host answered, page gone) now splits from `unreachable`
(no such host); only the second stops counting as a publisher, and the
fabrication gate fires when no page opened at all. Also fixed: seeded sample
checks (`provider: 'demo'`) counted toward the searches and tokens lines in
Settings. And note that the Dodgers sample is an open, overdue prediction, so
it takes a slot on the first pull and pushes GTA VI to the second.

**First wrong verdict on a real claim (build c1e7dee).** The rogue-drone seed
("first rogue AI drone strikes in the next 6 months", recorded twenty days
before install, so August 24) settled as a hit on two working links, NYT and
LA Times, both published August 24 and 27. The strike they describe happened
in July. The publication gate is the app's and it passed; the event date is
the model's and it was never told the period had a start. The check prompt now
states the period explicitly (rule 1 and a line in every check's input) and
tells the model that reporting dates are not event dates. Predicted outcome on
a re-check of that claim: ambiguous, queued, with the summary naming July.
The owner was asked to reopen it, and then pointed out the second
thing wrong with it: the claim said "rogue" and the criteria tested
"autonomous". The intake prompt now has a carry-the-qualifiers rule and the
seed's criteria say what rogue means; on that reading the claim should read
"nothing yet".

Also confirmed on this build: the Custom Tab (a source link opened in a sheet
with its own close control, no download prompt), the tokens line in Settings,
the absent searches line, no "It happened anyway" on Anacortes, and the Dodgers
sample replaced by a real hit.

**Build "Say which build this is" (10:10 UTC), verified on device:** the
corrected drone seed checks as no_change with a correct summary; the Settings
build label reads as intended; a hand-typed "Apple will release a foldable
iPhone by June" produced a review card that kept "release" as a question
rather than softening it (carry-the-qualifiers working on a real intake) but
wrote a hedge into a criterion ("on or before June 30, 2027 (or June 1, 2027
depending on interpretation)"). The intake prompt now forbids hedges inside
criteria. A no_change check no longer marks criteria unmet, since "not yet"
was drawing red crosses on open claims. The "Settle these first" copy now
says what the checkboxes are: an acknowledgement gate on confirming, storing
nothing.

Three more things PR #3 adds to look for: Anacortes settling itself as a miss
with no approval card; a "Not right? Reopen it" link under "Settled by the
app"; source links opening in a browser sheet that closes back to the app.

**What to look at on the next build.** Uninstall the previous APK first (each is
signed with a throwaway key), and wipe data in Settings so the seed rewrites.
Then one pull on the feed:

- The Super Bowl detail screen: both criteria ticked on the HIT.
- Any check log entry: no score rows, a "N sources, links work" chip, green
  checks on the links, the gate list if any, the model's confidence line.
- The Anacortes entry: "Settled by the app", and no "Still watching until"
  line (dated claim, no late watch).
- Expand a check's chip and look for "What the provider said". If it is there,
  it holds the raw grounding metadata. Send that screenshot; it settles bug 4.
- The Dodgers sample is unchanged and still badged Sample.

---

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
- **Freeze at confirm rather than at first check** was recommended in the
  review and not decided. The window between confirm and first check is
  unaudited, and for a far-out claim that is a month at the earliest.

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
- **Each APK is signed with a throwaway key**, so Android refuses to install over
  the previous build. The owner has to uninstall first. Say so every time.
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

6. **Criteria frozen at first check, amendable with an audit trail.** Holds.
   Freeze-at-confirm was recommended and is undecided (section 5).

7. **Quoted-text matching in any form.** No. Removed. The quote is still
   requested and shown, as the citation, for a person to read.
