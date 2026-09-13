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
**Bug 4 is instrumented but not fixed**: the `webSearchQueries` field name
matches the published API docs, so "the capture is wrong" may itself have been
the wrong diagnosis. Two other explanations: the `gemini-flash-latest` alias
returns thinner grounding metadata than the pinned models (a developer forum
thread reports `groundingChunks` missing on that alias), or the model did not
search at all. The second would matter more than the budget: an unsearched
answer to a question about a February 2025 game is the model recalling, and a
recalled answer is where invented URLs come from. The diagnostic on the next
build says which.

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

- **Build loop.** Push to `main`, GitHub Actions runs types, tests, then builds a
  debug APK and replaces the rolling `latest` release. There is no `gh` CLI in
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
