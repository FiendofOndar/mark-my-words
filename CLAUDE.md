# Mark My Words

A ledger for predictions and the people who make them. Read [SPEC.md](./SPEC.md)
before changing behavior; every design decision is recorded there with its
reasoning, including the ones that look arbitrary.

## Commands

```bash
npm run dev        # http://localhost:5173
npm test           # 216 tests, all of them fast
npm run typecheck
npm run build
npm run android:apk   # needs the Android SDK, which the build container lacks
GEMINI_API_KEY=... node scripts/validate-gemini.mjs   # the only live model call
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

## Rules the product depends on

These are not implementation details. Changing any of them changes what the app
is for.

- **Criteria freeze on the first check.** After that, editing goes through the
  amendment log with a required reason. Editing is allowed; hiding the edit is
  not. This is the whole anti-slippage mechanism.
- **A late hit never changes the verdict.** The timeframe was part of the claim,
  so a miss stays a miss and earns a badge instead.
- **Model confidence can only lower the score, never raise it.** The score is
  computed by the app from evidence the app verified itself.
- **Every cited URL is fetched and searched for the quoted passage.** A verdict
  resting on an unreachable citation never auto-resolves.
- **`blocked` is not `unreachable`.** A bot wall or a CORS refusal means the app
  could not check; a dead host means the citation is probably invented. Only the
  second one is treated as evidence of a fake. Calling a real citation invented
  is the one mistake this layer exists to prevent.
- **Retroactive entries never count toward a hit rate.** Backfilled predictions
  are cherry-picked by construction.
- **The API key never touches the database**, because Settings exports the whole
  database file.

## Unverified

- **Grounded checks on a free Gemini key get 20 per day.** They are billed
  against `GenerateRequestsPerDayPerProjectPerModel-FreeTier` (quotaValue 20,
  5/min), not the 5,000/day grounding allowance, which needs billing. The whole
  cadence design exists because of numbers like this; do not add anything that
  spends a check casually.
- **A spent allowance ends the pull and blocks the next one.** Otherwise every
  further attempt is a guaranteed failure that still costs a request and fills
  the log with identical errors. `readCooldown` gates it, and the feed offers a
  deliberate override.
- **A 429 with no retry delay is the daily bucket.** A per-minute limit always
  carries one. That absence is the signal, and daily quotas reset at midnight
  Pacific, not local midnight and not on a rolling 24 hours.
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
