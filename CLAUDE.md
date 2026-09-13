# Mark My Words

A ledger for predictions and the people who make them. Read [SPEC.md](./SPEC.md)
before changing behavior; every design decision is recorded there with its
reasoning, including the ones that look arbitrary.

**Starting a fresh session: read [HANDOFF.md](./HANDOFF.md) first.** It carries
the owner's working constraints, the reasoning behind the decisions that took
longest to reach, where the last run actually landed, and the open bugs with
their diagnosis already done.

## How we work

Process rules, not style rules. Every one of them is here because skipping it
cost real time on this project, and the note after each says what it cost.
Ordered by value, because the ones at the top get followed best.

**This section is portable.** Nothing in it is specific to this app. Copy it
whole into any other repository's CLAUDE.md.

**Diagnose before fixing.** Before the first code change on a bug, list the
likeliest causes and how we would tell them apart. If there is only one
candidate, say why the others are ruled out. *Nine consecutive rounds were spent
fixing nine different mechanisms that each suppressed a correct verdict, one
symptom at a time.*

**Label the basis of every factual claim.** When asserting an API shape, a
response field, a config key, a library behavior, a version or a limit, say
whether it came from a file you just read, from documentation fetched this
session, or from memory. Memory is a hypothesis. Verify before shipping
anything that depends on it. *`groundingMetadata.webSearchQueries` was written
from memory, stated as fact, shipped, and returned nothing.*

**The third-time rule.** When you are about to fix a third distinct mechanism
producing the same user-visible symptom, stop. Say so, name the pattern you
think is underneath, and propose the structural change instead. Raise this
yourself; do not wait to be asked. *The insight that the scoring layer was
structurally adversarial to correct answers was available after failure three
and was not named until failure nine.*

**Instrumentation beats iteration.** If diagnosing something would take more
than two trips through a slow or costly feedback loop (a device build, a paid
API call, a deploy), stop and propose building visibility first. Say what it
would cost and what it would show. *An afternoon spent on a debug view would
have paid for itself four times over.*

**Capture the failure before fixing it.** When a real failure is observed, save
the actual inputs and outputs as a fixture and write the failing test before
changing anything. An expensive loop becomes a free one. *Every diagnosis here
went through a ten-minute phone round trip and a paid API call.*

**Predict the outcome.** Before handing back something to test, say what should
be visible if it worked and what should be visible if it did not. If you cannot
name a difference, it is not testable yet and should not ship.

**Report what you ran, not what you wrote.** A feature is not working because
the code exists. Say what command you ran, what it printed, and what you
observed. "Tests pass" needs the count. "It builds" needs the output.

**Open-ended time needs a boundary.** When given an autonomous stretch, restate
the constraints before starting: what is in scope, what is off limits, what done
means. If none were given, propose them and work to your own proposal. *The
worst defects of this project were produced during unbounded autonomous work.*

**Surface silent judgment calls.** When a change required picking a number, a
threshold, a weight or a default that was not specified, list them at the end of
the work. Do not bury them in a diff. *A series of unreviewed scoring weights,
several of them wrong.*

**Never invent data.** No fabricated facts in fixtures, seeds, samples, demos or
examples. If a fixture states something checkable, verify it against a real
source first and say in the commit that you did. Labelling it sample data is a
backstop, not a licence. *A fabricated World Series result sat in the seed,
was believed, and was reasoned from.*

**Say what you did not do.** If part of a task was skipped, blocked, or finished
only partly, say so in the same message as the result. Never report completion
for partial work.

**Cheapest version first.** For anything touching more than one file or costing
money, propose the smallest version that would show whether the idea is right
before building the full one.

**Name the cost before spending it.** Paid API calls, long builds, anything with
a bill attached.

**Fix the record in the same commit.** When you discover that something written
in CLAUDE.md, HANDOFF.md or SPEC.md is no longer true, correct it as part of the
change that made it untrue. *Three claims in this file went stale inside a
single day, including one asserting that the thing we had just proven working
had never run.*

**Re-read this file when resuming from a summary.** A long session compacts, and
what survives is the task, not the rules. If you are picking up from a
summarized context, read this before acting.

## Commands

```bash
npm run dev        # http://localhost:5173
npm test           # 334 tests, all of them fast
npm run typecheck
npm run build
npm run android:apk   # needs the Android SDK, which the build container lacks
GEMINI_API_KEY=... node scripts/validate-gemini.mjs   # the only live model call

# Screen sweep: console errors, overflow, tap targets, a screenshot per screen.
npm run dev &
npm i --no-save playwright
OUT=/tmp/audit node scripts/ui-audit.mjs
```

## Shape of the code

```
src/domain/        pure rules, zero I/O
src/data/          driver port, migrations, repositories, row mapping
src/verification/  provider port, prompts, parsing, source validation, the pull
src/notifications/ delivery port and preferences
src/capture/       share target, archiving, retry queue
src/receipts/      the shareable cards
src/platform/      every native adapter
src/ui/            screens and components
```

`src/domain/` is plain functions over plain objects. The state machine, the
cadence gate, the confidence rubric, the hit-rate math and the notification
planner all live there and are tested without a database or a network. That is
where the bugs live, so that is where the tests are.

Everything the web cannot do properly sits behind a port: `Persistence`,
`PageFetcher`, `Notifier`, `ImageSharer`, `SecureStore`, `Verifier`.
`src/platform/index.ts` is the only file that knows there are two answers. Add a
capability by adding a port, not a branch.

## Things that will bite you

- **sql.js `export()` closes and reopens the database**, silently ending any
  open transaction. `SqlJsDriver` never persists mid-transaction. Keep that.
- **Unlayered CSS beats layered Tailwind utilities.** All custom CSS is in
  `@layer base` / `@layer components`. A bare `button { color: inherit }` reset
  once beat `text-ground` on every button in the app.
- **Never rasterize a `position: fixed` element.** html-to-image clones into an
  SVG `foreignObject`, where a fixed root is out of flow and renders nothing.
- **Fonts are self-hosted** (`public/fonts`), and the receipt inlines them.
  Not only for offline launch: a `foreignObject` cannot reach an external font,
  so receipts rasterized with remote faces silently come out in a fallback.
  Self-hosting alone was not enough: `useReceipt` once handed html-to-image the
  stylesheet text as `fontEmbedCSS`, which the library inserts verbatim, and a
  `url(./face.woff2)` cannot load inside the SVG image either. Every card
  rendered in a system face for months and nobody could tell, until the
  condensed display face arrived and the stamp overflowed its own box.
  `getFontEmbedCSS` is what turns each face into a data URL.
- **Timestamps tie.** Two rows written in one transaction routinely share a
  millisecond. Order by `ran_at DESC, rowid DESC`, never by the timestamp alone.
- **A failed check must not consume the cadence slot**, or one bad key pushes
  every prediction a full interval into the future.
- **The notification plan is replaced, never incremented.** Android battery
  managers drop scheduled alarms, so it is recomputed and re-armed on every
  change; stable ids make that idempotent.
- **Shared state belongs in one place.** Notification preferences were briefly
  two `useState` copies of the same row and silently diverged.
- **Measure a scroller with a ResizeObserver, not on render.** On first render
  the display font has not loaded, so the filter strip measured as not
  overflowing and drew no edge fade until someone scrolled it.
- **Chrome draws an unchecked checkbox as a solid white box.** On the dark
  ground that made a checkbox the loudest thing on screen. Use `.checkbox`.
- **A disabled cream fill becomes a muddy grey block**, whether by `opacity-40`
  or `bg-ink/20`, and reads as pressed. `primaryButton` swaps to a surface
  token instead. Use `primaryButton` / `secondaryButton`, not a fourth copy.
- **The suite runs in `America/Los_Angeles`, not UTC.** Nearly every date rule
  here is local, and under UTC a correct implementation and a `toISOString()`
  one are indistinguishable. One shipped that way: checks after 5pm Pacific told
  the model it was already tomorrow. Do not "simplify" the TZ out of the config.
- **Never type "·" in front of list items.** `Bullets` renders one item as a
  sentence, because a bullet in front of a single line is just a dot.

## Rules the product depends on

These are not implementation details. Changing any of them changes what the app
is for.

- **Criteria freeze when the prediction is confirmed.** After that, editing
  goes through the amendment log with a required reason. Editing is allowed;
  hiding the edit is not. This is the whole anti-slippage mechanism. They used
  to freeze on the first check instead, which for a claim due months out left
  a long window of quiet edits; the owner chose confirm-time on 2026-09-13. `amendCriterion` is the route:
  criteria live in their own table, so `amend` (which takes a `keyof
  Prediction`) cannot reach them, and for a while the rule above was documented
  but not implemented. A frozen criterion nobody can correct is a prediction
  that can never be settled, which is a worse failure than an edit on record.
- **The feed sorts by heat, and heat flattens past sixty days.** Everything
  further out scores identically, so `sortByHeat` must keep breaking the tie
  itself: deadline first, then `updatedAt`, then the id. Without the last two
  the same eight predictions came back in a different order on every load.
- **A late hit never changes the verdict.** The timeframe was part of the claim,
  so a miss stays a miss and earns a badge instead.
- **Tier and independence come from the domain, never from the model.** Both
  arrived as fields in the model's own JSON and were taken at face value, so
  fifty-five of the hundred points were the model grading itself: a blog could
  be filed `primary`, and two pages on one site labelled "AP" and "Reuters"
  counted as two independent sources. `src/domain/sources.ts` decides both from
  the URL, and flags a publisher name the host cannot support.
- **The verdict decides. There is no score.** A 0-100 evidence rubric used to
  sit beside the gates. First it decided (a correct miss filed as "no change"
  because two pages had been rewritten since the model read them), then it was
  demoted to information on the check log, where it printed two structurally
  wrong numbers on correct checks. It is gone. `src/domain/gates.ts` is what is
  left: a gate is something the app noticed about the citations, and the only
  other thing that stops a verdict is the model reporting confidence under
  `CONFIDENT_AT`. Both queue the verdict for the user; neither buries it. Do
  not bring a composite number back.
- **One source is enough when it is the body that keeps the record.** The NWS
  does not report a temperature, it measures it, and requiring a second
  independent outlet before believing it blocked a correct verdict four times
  running. A lone `primary` source (a .gov host, or a governing body the table
  knows) clears the corroboration gate; anything else still needs two. Only
  safe because the tier comes from the domain now rather than from the model.
- **Fabrication looks like nothing resolving, not like something failing.** Any
  single dead link used to gate the check, and it twice stopped a correct
  verdict backed by two pages that did resolve. A model that found real pages is
  not inventing citations; it got one deep link wrong. The gate fires only when
  no cited page could be opened at all. `blocked` gates nothing.
- **`missing` is not `unreachable`.** A real host answering "no page here" is
  a rotted or misremembered deep link on a publisher that exists; a host that
  does not exist is what an invented citation looks like. Only the second
  costs its place in the independent-source count. Two rotted deep links on
  Return of the King once held a verdict that three agreeing sources carried.
- **The period starts on the recorded date, and only the model can check
  the event date.** The app gates on publication dates; it cannot know when
  an event happened. The first wrong verdict on a real claim was a July drone
  strike, reported August 24 and 27, applied as a hit on a claim recorded
  August 24: every source postdated the claim, the event did not, and the
  summary led with the reporting dates. The check prompt now states the
  period's start explicitly and tells the model that reporting dates are not
  event dates. The intake criteria for a "will happen" claim should carry the
  start too; that is prompt-level and worth re-testing when it drifts.
- **Carry the qualifiers.** The same verdict was wrong a second way: the
  claim said "rogue" (against its orders or programming) and the seeded
  criteria tested "autonomous" (no human in the loop), which is a far easier
  claim. The testable version is where meaning gets lost, and once confirmed
  it is what every check judges, faithfully. The intake prompt now requires
  narrowing words to survive into the criteria or be raised as ambiguities.
  The owner caught this one from the raw statement; the review card is the
  only place a person can.
- **Reporting comes after the event, so a late publication date is not a
  problem.** A rule once required every source to be published before the
  deadline the claim named. A Sunday night game is written up on Monday
  morning; a check run six months later cites a retrospective from six months
  later. A publication date cannot tell you an article is about the wrong
  event - only its contents can, and that is the criteria's job. What is still
  gated: a check where every source predates the prediction. An undated source
  is unknown, not old.
- **A gate fires on "nothing here works", never on "one thing does not".** This
  shape has now been wrong four times: any single dead link gated the check,
  any single stale quote gated it, any single source older than the prediction
  gated it, and any single mislabelled publisher gated it (a YouTube link
  called ESPN held a verdict carried by mlb.com and Wikipedia). Each time a
  correct verdict carried by the other sources was blocked by one bad citation
  among them. Citing background alongside the decisive article is not a defect.
  The bad one is marked on its row; the gate is reserved for a check where
  every source failed the same way.
- **`hold` is only for a check that resolved nothing.** A verdict the app cannot
  act on is still a verdict somebody should see.
- **Model confidence is read once, as a reason to ask.** Under `CONFIDENT_AT`
  the verdict is queued. It never makes a verdict stronger.
- **A seeded check is indistinguishable from a real one on screen, so it must
  never assert anything false.** The seed once claimed a World Series winner for
  a season that had not been played, on example.com URLs under real wire-service
  names, with `fetchStatus: 'ok'` hardcoded so the app reported a quote verified
  on pages it had never opened. It was believed, twice. The sample verdict now
  carries a result checked against live sources, on the publishers' real
  addresses, with no quoted text and no fetch result, because nothing in a seed
  was ever fetched. The badge is the backstop, not the fix: anything rendering a
  check must badge `provider === 'demo'`, and evidence rows must show the host
  rather than only the publisher name.
- **`not_checked` is not `blocked`.** Blocked means the app tried the page and
  was refused. Not checked means nobody tried: a seeded sample, an imported
  record. The sample verdict marked three real addresses "page would not open"
  about pages the app had never opened, in the one part of the screen that
  exists to say what the app confirmed for itself.
- **`blocked` is not `unreachable`.** A bot wall or a CORS refusal means the app
  could not read the page; a dead URL means there may be no page. Neither is
  proof of a fake on its own. Calling a real citation invented is the one
  mistake this layer exists to prevent.
- **The link check is a link check.** `validateSources` opens each cited URL
  and records whether it answered. It does not read the page. Two generations
  of text matching lived here (verbatim, then figures-and-names, with month
  tables and unit normalisation) and neither answer ever reached a decision:
  a real page whose wording moved on is still a real page, and the matcher
  could not tell drift from invention by its own admission. Most of one
  session's bugs were in that layer. Do not rebuild it; the quoted passage is
  shown as the citation and the reader judges it.
- **A hit rate is never shown for an author who is not ranked.** `formatHeadline`
  is the one place that decides. A 1-0 record printed as "100%" is the
  cherry-pick the five-call threshold exists to refuse, and it had reached the
  shareable card. Show the record until the rate means something.
- **Retroactive entries never count toward a hit rate.** Backfilled predictions
  are cherry-picked by construction.
- **The billing unit for grounding is unverified.** Secondary pricing pages
  (official docs are blocked from the build container) say the 2.5 family
  bills per grounded prompt and the 3.x family per search query; which one
  `gemini-flash-latest` resolves to is what the `modelVersion` diagnostic is
  for. Nothing in the API limits how many searches the model runs, so the
  stopping rule and the twelve-search ceiling live in the prompt and can be
  ignored. `MAX_SOURCES` is the part that does not depend on the model
  agreeing. The month-to-date counter counts checks, not searches.
- **A place gets pinned as tightly as a number.** "A station serving Anacortes,
  WA" has no edge to it, and a Sea-Tac climate summary seventy miles south was
  cited as though it covered the town. The structuring prompt asks for a named
  station, municipality or distance; the check prompt refuses a reading from
  somewhere else. The app cannot check geography itself without a geocoder, so
  both of these are prompt-level and worth re-testing when they drift.
- **Grounding returns redirect URLs.** Gemini cites
  vertexaisearch.cloud.google.com links, so anything judged from a domain was
  being judged about Google: two outlets collapsed to one source and a .gov
  record scored as an unknown site. `PageFetchOutcome` carries the final URL and
  a source is recorded against where the fetch landed, not where it pointed.
- **A criterion dated after the deadline is refused at review.** A criterion is
  judged at the deadline, so a later date inside it can never be met in time.
  The seed produced exactly this (deadline the 11th, criteria the 12th) and
  every check then answered "not yet" forever while the feed showed the claim
  overdue. Earlier dates pass; criteria often measure against one.
- **Never `.slice(0, 10)` a stored instant to get a date.** Deadlines are local
  end-of-day, so west of Greenwich the UTC date is already tomorrow. Use
  `toLocalDateInput`. This has now shipped twice: once in the check prompt, once
  in the seed's own prose, and both times only misbehaved after 5pm Pacific.
- **A late-watch re-check must never re-apply the verdict.** The likeliest
  answer on a settled miss is "still a miss", and passing that to `resolve`
  throws on the miss-to-miss transition. It once ended the whole pull. Under
  late watch anything but a hit records the check and changes nothing, and the
  pull loop files anything that escapes `runCheck` as a failed check row.
- **A negative claim is settled by asking, not by the model.** An absence has
  no sources, and a sourceless verdict is held open by the parser, so the
  model can never deliver the hit the spec describes. Past the deadline, a
  check that finds nothing queues a hit for approval. The prompt tells the
  model never to return hit on a negative claim.
- **Late watch is for claims that can still happen.** Every miss used to get
  three years of monthly paid checks, including a day's high temperature. The
  deadline type cannot tell "Bitcoin by the end of 2024" from "85F on
  September 12", so the intake model answers `can_happen_late`, the review
  card shows it as a checkbox on dated claims, and `defaultLateWatch` and the
  "it happened anyway" control both read it.
- **A cost figure the app cannot see is a cost figure it does not show.**
  Settings reports tokens (the provider reports a total per check) and says
  in the same sentence that it is not a bill: input and output are priced
  differently and only the sum arrives, and search queries are billed
  separately and not reported at all. Do not add a dollar estimate from a
  price table in memory.
- **`groundingMetadata.webSearchQueries` has never arrived on a real check.**
  The field name is from the published docs (verified by search this session,
  not fetched), and the first real diagnostic showed the whole
  `groundingMetadata` object absent. When it does arrive it is recorded per
  check, shown on the log with the queries, and totalled for the month in
  Settings. Until then the check log prints the response's own shape under
  "What the provider said" so the next guess is not from memory.
- **Checks are only ever spent by a deliberate tap.** `runPull` has one caller,
  reached from the feed refresh gesture or a detail screen's "Check now". No
  timer, no launch effect, no background service. Keep it that way: the cadence
  gate, the per-pull budget of 6 and the daily ceiling are all downstream of
  that, and every check costs the user money now.
- **The API key never touches the database**, because Settings exports the whole
  database file.

## The six live test fixtures

The seed carries six predictions that exist to be checked against a real key,
each testing a different shape of check. One pull covers all six, which is why
the per-pull budget is six and why there are not more.

| fixture | expected | what it tests |
|---|---|---|
| Anacortes weather | miss, settled | numeric threshold, pinned place, a .gov page that rewrites hourly |
| Super Bowl LIX | hit, settled | two discrete facts, static recaps; caught the criterion index bug |
| Return of the King | hit, settled | a film plot point: nothing measured, only what happens in the story |
| Oppenheimer Oscars | partial, queued | one criterion holds and one fails; the mixed ticks and the approval card |
| Moon landing (negative) | hit, queued | an absence: the model finds nothing, the app queues the hit past the deadline |
| GTA VI | no_change, open | an unresolved claim: trend, countdown, and `canHappenLate` |

Every fact in them was verified against live sources before seeding, and the
commit that added each says so. A fabricated demo verdict about a real team has
already misled someone once here; do not do it again. Two other open seeds are also
searchable: the CNN winter forecast (cannot resolve before winter) and the
rogue-drone claim, dated twenty days before install, which resolved on its
second real check and produced the first wrong verdict (see the period-start
rule above). It is a real prediction with a moving statement date, not a
controlled fixture; treat its outcome as a test of the prompt, not of the
world.

## Unverified

- **Never let a tested credential differ from the stored one.** Settings once
  tested the typed key while every check used the last saved one, so a new key
  could pass its test and never be used. Anything that spends a request commits
  first, and the hint says which key is actually in force.
- **The key is now on billing with a hard $25/month cap**, so the free-tier
  ceiling below is no longer what binds. The cadence design still stands: every
  check costs money now rather than costing an allowance.
- **Grounded checks on a free Gemini key get 20 per day.** They are billed
  against `GenerateRequestsPerDayPerProjectPerModel-FreeTier` (quotaValue 20,
  5/min), not the 5,000/day grounding allowance, which needs billing. The whole
  cadence design exists because of numbers like this; do not add anything that
  spends a check casually.
- **A spent allowance ends the pull and blocks the next one.** Otherwise every
  further attempt is a guaranteed failure that still costs a request and fills
  the log with identical errors. `readCooldown` gates it, and the feed offers a
  deliberate override.
- **A 429 with no retry delay is probably, not certainly, the daily bucket.** A
  free key's exhaustion and a paid key's momentary limit look identical. The
  hold escalates rather than assuming the worst: fifteen minutes, then an hour,
  then the reset at midnight Pacific, which is where daily quotas actually roll
  over. Strikes live outside the cooldown so lifting a hold does not erase what
  was learned; only a successful check resets them.
- **A 429 is three different limits.** Per minute, per day, and a separate
  allowance for Google Search grounding. The body says which, and carries a
  `retryDelay`. Never collapse them into one message: telling someone to come
  back tomorrow when they hit a 10-per-minute cap is both wrong and infuriating.
  `parseQuotaFailure` reads it; a short wait is retried once, automatically.
- **Listing a model does not mean the key can call it.** The API reports what a
  model supports, not what a key is entitled to, so paid-only models show up in
  every free key's list. Selecting one in Settings tries it rather than trusting
  the listing.
- **Model ids get retired per account.** `gemini-2.5-flash` stopped being
  available to new keys and the app hard-failed on it. The default is now the
  `-latest` alias, and Settings can list what a key actually has, which is the
  fix that survives the next rename. Never hardcode a pinned version as a
  default again.
- **Grounded verification now works end to end, as of 2026-09-12.** Three
  manual checks against a live key returned three correct verdicts: the
  Anacortes miss and the Super Bowl hit both settled without asking, and the
  Dodgers hit was held because the model cited a YouTube link and labelled it
  ESPN (that gate has since been narrowed: the two clean sources should have
  carried it). The page check confirmed three quotes verbatim and matched one
  on its figures, against 1, 2, 0 and 0 on the four runs before it; the layer
  was then reduced to a link check, because none of those confirmations reached
  a decision. What is still unverified is the search-count instrumentation,
  which came back empty; the next build prints the raw grounding metadata on
  the check log when that happens (see HANDOFF.md, bug 4).
- **The Android build runs on a real device.** Debug APKs from CI have been
  installed and exercised on the owner's phone: notifications, the check
  pipeline, Capacitor HTTP fetching of cited pages. The build container still
  has no Android SDK, so `npm run android:apk` only works in CI.
