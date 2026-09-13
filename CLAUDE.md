# Mark My Words

A ledger for predictions and the people who make them. Read [SPEC.md](./SPEC.md)
before changing behavior; every design decision is recorded there with its
reasoning, including the ones that look arbitrary.

## Commands

```bash
npm run dev        # http://localhost:5173
npm test           # 328 tests, all of them fast
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
- **Fonts are self-hosted** (`public/fonts`). Not only for offline launch: a
  `foreignObject` cannot reach an external font, so receipts rasterized with
  remote faces silently come out in a fallback.
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

- **Criteria freeze on the first check.** After that, editing goes through the
  amendment log with a required reason. Editing is allowed; hiding the edit is
  not. This is the whole anti-slippage mechanism. `amendCriterion` is the route:
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
- **The verdict decides. The score describes.** The rubric measures whether the
  citations check out, and it was being read as though it measured whether the
  answer is right. Those are different questions, and requiring 95/100 of the
  first meant the app could get a correct miss and file it as "no change"
  because two pages had been rewritten since the model read them. The score is
  information on the check log now. Only two things stand between a verdict and
  the record: a gate, and the model reporting confidence under `CONFIDENT_AT`.
  Both ask the user; neither buries the finding.
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
  every cited source is unreachable. A dead link still costs its place in the
  independent-source count, because a page that does not exist corroborates
  nothing. `quote_not_found` and `blocked` cost points and gate nothing.
- **`hold` is only for a check that resolved nothing.** A verdict the app cannot
  act on is still a verdict somebody should see.
- **Model confidence can only lower the score, never raise it.** The score is
  computed by the app from evidence the app verified itself.
- **The seed writes checks that look exactly like real ones.** `provider:
  'demo'`, example.com URLs under real wire-service names, `fetchStatus: 'ok'`
  hardcoded so the app says "quote verified" for a page it never fetched, and a
  World Series winner for a season that has not been played. Anything rendering
  a check must badge `provider === 'demo'`, and evidence rows must show the
  host, not only the publisher the model typed.
- **`blocked` is not `unreachable`.** A bot wall or a CORS refusal means the app
  could not read the page; a dead URL means there may be no page. Neither is
  proof of a fake on its own. Calling a real citation invented is the one
  mistake this layer exists to prevent.
- **The page check matches on facts, not on wording.** Verbatim matching
  confirmed 1, 2, 0 and 0 citations across four real runs, because a model
  writing from a search snippet reproduces the substance of a line reliably and
  its exact phrasing almost never. `pageSupportsQuote` asks the narrower
  question the layer actually exists to answer: does this page carry the
  figures, dates and names the verdict rests on? All of them, or it is a miss -
  a partial hit is what the wrong year and the wrong town look like, and both
  have really happened here. A page passing that but not the verbatim match is
  `facts_found`, worth 16 of 20 against a verbatim 20.
- **Dates and units are where this breaks, so both are normalised.** A weather
  service climate report writes "SEPT 5 2026." and "71F" where the model wrote
  "September 5, 2026" and "71 degrees". Months collapse to three letters against
  an explicit table (never a prefix match: "may" is a prefix of "mayor"), digit
  runs are pulled out of alphanumeric tokens, an ISO date expands to year,
  month and day, and trailing periods are trimmed off page tokens - `words`
  keeps them, because it also has to keep the one in "71.4".
- **A hit rate is never shown for an author who is not ranked.** `formatHeadline`
  is the one place that decides. A 1-0 record printed as "100%" is the
  cherry-pick the five-call threshold exists to refuse, and it had reached the
  shareable card. Show the record until the rate means something.
- **Retroactive entries never count toward a hit rate.** Backfilled predictions
  are cherry-picked by construction.
- **Grounding bills per search query, not per prompt.** One check that searches
  three things is three billable uses. Nothing in the API limits how many
  searches the model runs, so the stopping rule and the twelve-search ceiling
  live in the prompt and can be ignored. `MAX_SOURCES` is the part that does not
  depend on the model agreeing. The month-to-date counter counts checks, not
  searches, so it undercounts the billable unit.
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
- **A citation the app could not confirm is not a citation it disproved.** A
  moved quote and an invented one are different things. Live pages (forecasts,
  scoreboards, "today" pages) rewrite themselves between the model reading them
  and the app fetching them, so `quote_not_found` on a page that served content
  earns a little credit and `facts_found` earns most of a hit. `blocked` still
  earns nothing: the page was never read.
  The check prompt tells the model to cite the record, not the forecast.
- **Checks are only ever spent by a deliberate tap.** `runPull` has one caller,
  reached from the feed refresh gesture or a detail screen's "Check now". No
  timer, no launch effect, no background service. Keep it that way: the cadence
  gate, the per-pull budget of 6 and the daily ceiling are all downstream of
  that, and every check costs the user money now.
- **The API key never touches the database**, because Settings exports the whole
  database file.

## The two live test fixtures

The seed carries two predictions that exist to be checked against a real key,
chosen to be opposites on every axis that matters. Running one pull settles both
and produces two independent data points per attempt.

| | Anacortes weather | Super Bowl LIX |
|---|---|---|
| verdict | miss | hit |
| criteria | one numeric threshold | two discrete facts |
| place | pinned to a locality | none |
| sources | a .gov page that rewrites hourly | static recaps from Feb 2025 |
| tier | primary | major outlet, plus nfl.com |

The Super Bowl one is the only fair test of the page check in the app: those
recap pages have not changed since the night they were published. If nothing can
be confirmed there - not even on the figures - the page-fetching layer is not
earning its keep and should be reduced to a reachability check.

Its result was verified against live sources before seeding. A fabricated demo
verdict about a real team has already misled someone once here; do not do it
again.

## Unverified

- **Never let a tested credential differ from the stored one.** Settings once
  tested the typed key while every check used the last saved one, so a new key
  could pass its test and never be used. Anything that spends a request commits
  first, and the hint says which key is actually in force.
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
- **Grounded verification has still never run for real.** Reachability and
  structured intake are confirmed against a live key; the Google Search
  grounding path and whether cited quotes appear on cited pages are not.
  `scripts/validate-gemini.mjs` checks all of it.
- **No native adapter has been run on a device.** `src/platform/` is written to
  the documented APIs and compiles, but the build container has no Android SDK.
