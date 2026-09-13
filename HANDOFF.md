# Handoff

Written at the end of a long session so the next one starts oriented instead of
rediscovering. Read this, then `CLAUDE.md`, then `SPEC.md` if you are changing
behavior.

`CLAUDE.md` holds the engineering rules and why each exists. This file holds
everything else: how the owner works, what the app is for, where we actually
are, and the four open bugs with their diagnosis already done.

State at the time of writing: `f258ad5`, pushed, CI green, 354 tests, schema v7.

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

**The verdict decides. The score describes.** Gemini makes the determination.
The app's job is to notice when the citations do not hold up, not to
second-guess the answer. This was the single biggest change of the session: for
weeks the app was getting correct answers from the model and refusing to act on
them because a composite evidence score had not cleared 95. The score is now
information on the check log. Two things still stand between a verdict and the
record: a gate (something the app actively noticed was wrong) and the model
saying it is unsure (confidence under 70).

**Source verification is a fabrication guardrail, not a verdict input.** The
owner challenged this directly: "can you explain exactly why we think the app
needs to verify the sources at all? As far as I can tell, it seems like it's
just verifying did the source say what Gemini says the source said." The answer
that survived: a model that invents a plausible URL is the failure mode worth
catching, and nothing else in the pipeline can catch it. Anything beyond that is
the model's job.

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

As of this morning the pipeline works end to end for the first time. Three
manual checks on the two live fixtures plus the sample:

| | verdict | correct? | outcome |
|---|---|---|---|
| Anacortes weather | miss | yes | settled by the app |
| Super Bowl LIX | hit | yes | settled by the app |
| Dodgers 2025 WS | hit | yes | held, correctly |

The Dodgers hold is the publisher-mismatch gate earning its keep for the first
time: the model cited `m.youtube.com` and labeled it ESPN, and the app noticed
the name does not match the host. Two real confirmations on `mlb.com` and
`en.wikipedia.org` carried the finding; the third citation was not what it said
it was.

**The page-fetching layer finally does something.** This run: three verbatim
confirmations (`nfl.com`, `mlb.com`, `en.wikipedia.org`) and one figures match
(`forecast.weather.gov`). The four runs before it confirmed 1, 2, 0 and 0. The
change that did it was matching on the quote's figures, dates and names rather
than on its wording, because a model writing from a search snippet reproduces
the substance of a line reliably and its exact phrasing almost never.

Everything still on the list is bookkeeping accuracy, not verdict correctness.
That is a much better class of problem than what we started with.

---

## 5. The open bugs

### Bug 1: the criterion index is off by one. Confirmed, highest priority.

`src/verification/prompts/check.ts:86` renders the criteria list as `1. `, `2. `
and so on. The response schema asks for a field called `index` and nothing tells
the model it is zero-based. `src/verification/checkSchema.ts:122` treats it as
zero-based and drops anything `>= criteriaCount`.
`src/verification/runCheck.ts:125` then indexes `ctx.criteria[status.index]`.

Consequences, all observed in screenshots:

- On a one-criterion prediction the model returns `index: 1`, it is out of
  range, it is dropped, `criteriaStatus` is empty, and `coverageFrom` returns
  `'none'`. Both the Anacortes and Dodgers panels read **Criteria covered
  0/15** on checks that were otherwise correct and well sourced.
- On the two-criterion Super Bowl prediction the model's `1` marked the
  **second** criterion and its `2` was silently discarded. The detail screen
  showed the headline criterion unticked on a HIT.

This has been wrong since the feature existed. It also feeds the criteria
coverage line of the rubric, so that number has been computed from a partly or
wholly empty list the entire time.

Recommended fix: make the wire format 1-based so it matches what the prompt
actually shows the model, convert to 0-based in `parseCheckResponse`, and keep a
tolerant fallback that still accepts a 0-based response (if any returned index
is `0`, treat the set as 0-based; otherwise subtract one). Say so explicitly in
the prompt too. Add a test that a two-criterion response numbered 1 and 2 marks
both criteria, and one that a response numbered 0 and 1 still works.

### Bug 2: a figures match can confirm a quote with no figures in it.

`pageSupportsQuote` in `src/verification/validateSources.ts:232` requires at
least `MIN_DISTINCTIVE_TOKENS` (2) distinctive tokens and does not care whether
any of them is a number.

The Anacortes check was carried by a `forecast.weather.gov` row whose quote was
"Weather observations for the past three days for. Burlington/Mount Vernon,
Skagit Regional Airport." Seven proper nouns, zero numbers. The page genuinely
says it, so the match is not false, but it establishes nothing about whether
anywhere hit 85. The check log said "1 of 2 match on the figures," which
overstates what the app stood up.

The prompt already asks for the line carrying the numbers
(`src/verification/prompts/check.ts` rule 5) and the model quoted a page header
instead.

This one needs a decision, not just a patch. A blanket "must contain a number"
rule is wrong, because the Super Bowl criterion "the team they defeat is the
Kansas City Chiefs" has no number in it. The principled version is to pass the
criterion text into the matcher and require a numeric token in the quote only
when the criterion itself contains one. That means plumbing criterion context
into `validateSources`, which currently knows nothing about criteria. **Propose
this to the owner before building it.**

### Bug 3: an undated source zeroes the whole temporal line.

`src/domain/rubric.ts:194`: `if (!source.publishedAt) return 0;`

The Anacortes panel read **Dates make sense 0/10**. The NWS observations page
carries no publication date, because a government data table does not have a
byline. Scoring that as "the dates do not add up" is the same mistake as the
deadline rule removed in `a020bdd`, which punished a recap for being published
the morning after a night game.

Recommended fix: treat a missing date as unknown rather than as failure. Pay the
points when nothing predates the prediction, and consider partial credit when
some sources are undated. Keep the rule that a source published before the
prediction was made cannot report how it turned out.

### Bug 4: the search-count instrumentation does not work.

`src/verification/GeminiVerifier.ts:177` reads
`response.candidates?.[0]?.groundingMetadata?.webSearchQueries`. Neither
expanded check panel showed a "searches run" line, which means the field came
back null or empty on every real call. The owner is on the build that contains
the feature, so this is the capture being wrong, not the build.

Honest note: that response shape was written from memory rather than checked
against a real response. Fix it by capturing whatever `groundingMetadata`
actually arrives (store it, or surface it once) and looking at the real shape
before guessing again.

This matters more than its size suggests. It is the only way to find out whether
the twelve-search ceiling in the prompt is holding, and the owner's budget
question depends on it.

### Smaller things, noted and not yet fixed

- **"Settled automatically" is a misleading label.** Every check comes from a
  deliberate tap, so nothing is automatic from where the owner sits. What it
  means is "the app decided this without asking you." Say that instead.
- **Three years of late watch on a settled past-date observation.**
  `DEFAULT_LATE_WATCH` is `'3y'` (`src/domain/prediction.ts:144`). A daily high
  for a specific past date cannot become a hit later. Late watch is for "X will
  happen by Y" claims that land after the deadline. It keeps a settled
  prediction eligible for checks that cost money.
- **`wunderground.com` will probably never confirm.** It is a
  JavaScript-rendered app, so a plain fetch gets a shell with no readings in it.
  Both Weather Underground rows failed on a page whose quote was genuinely
  fact-dense. Consider telling the model to prefer server-rendered records.
- **The model cited `m.youtube.com` as ESPN.** Prompt rules 4 and 5 are not
  landing on video pages.
- **Stale comment** at `src/verification/runCheck.ts:117` still refers to the
  claim-period upper bound removed in `a020bdd`.

---

## 6. Proposed and deliberately not built

**The observation path.** Give criteria a structured `observable` (threshold,
unit, comparator) so the app does the numeric comparison itself instead of
asking a model to do it and then grading the homework. The architectural
diagnosis behind it: the app elicits a machine-checkable assertion, flattens it
into a sentence, then spends the rest of the pipeline recovering it with fuzzy
string matching. The owner raised the underlying complaint ("there has to be a
more efficient way for the system to check basic verifiable data like weather
statistics") but has **not approved building it.** Do not start it unprompted.

---

## 7. What has been tried

Prompt changes, with results, so nobody re-runs a failed experiment:

- **Anchoring the confidence bands worked.** Giving explicit meanings to 90-100,
  70-89, 40-69 and below-40, plus telling the model that disagreement between
  sources only lowers confidence if it could change the verdict, took a check
  from 35 to 98. Confidence has been 98 on every check since.
- **"Cite pages that will still say this tomorrow" did nothing measurable.** The
  model still cites live pages.
- **Explaining what `basis` means fixed a real failure.** The model was
  returning `none` on a correct miss because it read `basis` as "is the answer
  yes," which zeroed coverage.
- **Telling the model search costs the owner money, personally, is still
  untested**, because bug 4 means nothing is measuring it.

Errors made this session, recorded so they are not repeated:

- I blamed the drafting model for a date that my own seed code had written, and
  said so publicly before catching it. Check your own code before attributing a
  bug to the model.
- I seeded a fabricated Cardinals World Series result that the owner believed
  and reasoned from. Then I badged it "Sample" and left the false content in,
  which was the weaker half of the fix. The owner had to tell me to replace it.
- I misread "limit how many sources Gemini would **check**" as "cite" and pushed
  back on the wrong thing.
- I guessed the `groundingMetadata` response shape from memory. It did not work.

---

## 8. Operating notes

- **Build loop.** Push to `main`, GitHub Actions runs types, tests, then builds a
  debug APK and replaces the rolling `latest` release. There is no `gh` CLI in
  the container; use `curl` against the API with `$GH_TOKEN`. Poll with an
  until-loop in a background Bash call rather than chained sleeps.
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
  egress policy. `WebSearch` and `WebFetch` work. This is why real page behavior
  can only be observed through the owner's phone.
- **The two live test fixtures** are documented in `CLAUDE.md`. They are chosen
  to be opposites: a numeric threshold pinned to a locality against a forecast
  page that rewrites hourly, versus two discrete facts with no geography against
  static recaps. Running one pull settles both.

---

## 9. Assumptions worth attacking

Stated plainly so a reviewer can go at them. Each of these is load-bearing, each
was arrived at under time pressure inside a single long session, and none has
been stress-tested by anyone who was not also the person who built it.

1. **That a language model with web search is the right instrument for settling
   a factual claim at all.** The whole app rests on it. The alternative shape is
   an app that reads structured data directly for the claims that have it
   (weather, scores, prices, election results) and only falls back to a model
   for claims that do not. That alternative was sketched as "the observation
   path" and never built.

2. **That the app should verify citations rather than verify the claim.** The
   current pipeline elicits a machine-checkable assertion from the user, flattens
   it into a sentence, hands it to a model, and then spends the rest of its
   effort recovering the assertion with fuzzy string matching against pages the
   model cited. The owner already asked whether this earns its keep. The answer
   given was "it is a fabrication guardrail." That answer may be too generous to
   the layer.

3. **That the rubric should exist.** Five weighted dimensions produce a 0-100
   score that the code itself says does not decide anything. It survives as
   information on the check log. A number nobody acts on may be worse than no
   number, since it invites the reader to act on it anyway, which is exactly the
   failure it took a whole session to unwind.

4. **That gates and the score are separate mechanisms worth having both of.**
   Gates now carry all the decisions. The score carries none. That asymmetry
   arrived by subtraction rather than by design.

5. **That cost control belongs in the prompt.** The ceiling on searches is an
   instruction the model may ignore, with no app-side enforcement and (today) no
   working measurement. A per-check hard stop would have to live in the provider
   layer, and does not exist.

6. **That criteria frozen at first check, amendable with an audit trail, is the
   right integrity model.** It is the mechanism that makes the ledger mean
   anything, and it has been bent twice already for usability reasons.

7. **That quoted-text matching should survive in any form.** It confirmed 1, 2,
   0 and 0 citations across four real runs, then 3 verbatim and 1 on figures in
   the fifth. That fifth run is the only evidence the layer works, and one of its
   four confirmations matched on a page header containing no figures at all.
