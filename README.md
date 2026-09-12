# Mark My Words

A ledger for predictions and the people who make them. See [SPEC.md](./SPEC.md).

## Phase 0.4 (current)

Capture, intake, verification and notifications. A statement goes in, a model
drafts testable criteria, you confirm, pulls check it against the world, and the
app tells you when something is due or waiting on you.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # domain + data layer
npm run typecheck
npm run build
```

Demo predictions seed themselves on first run and cover every verdict state.
Erase them from Settings.

### What works

- SQLite schema (sql.js in the browser, IndexedDB-backed) with migrations
- Authors, predictions, criteria elements, amendments, intake notes
- Capture screen, AI-drafted resolution criteria, review card before the clock starts
- Drafts are real rows, so a capture survives a reload or a failed model call
- Ambiguities the model flags must be ticked off before a prediction can open
- Gemini adapter with typed errors, plus a keyless offline drafter
- Criteria freeze on first check or on resolution, amendments after that
- Pull-to-refresh runs checks under a cadence gate, a per-pull budget and a daily quota
- Every cited URL is fetched and searched for the quoted passage
- Evidence rubric scores each check; model confidence can only lower that score
- Auto-resolve at 95+, queue for approval at 80-94, hold below, with hard gates
- Check log shows every check, its sources, their validation state and the score breakdown
- Notification plan recomputed from scratch on every change: deadline day,
  questions only you can answer, and a weekly digest
- Predictions nothing can search ask you directly, with yes / no / not yet and a
  snooze that stops offering itself after four rounds
- Manual entry for all three deadline shapes: fixed date, window, event/race
- Feed sorted by heat, with filter chips and live counts
- Detail screen: quote, verdict or countdown, criteria, actions, amendment log
- Manual resolve into all six states, reopen, late-hit logging
- Amendments that require a reason and show on the record
- Standings with the five-prediction ranking floor
- Dark and light themes, persisted

### What is stubbed

- Receipts and standings polish (0.5), the Capacitor wrap, the share target and
  archiving (0.6).
- **Not one real model call has been made.** Every provider path is covered by
  tests against injected fakes, and the container this was built in has no API
  key. The model id, the grounding tool name and the real free-tier quota all
  need confirming against a live key before any of this can be trusted.
- Browser notifications only fire while a tab is open. The Settings screen says
  so rather than implying otherwise.
- The offline drafter is regex pattern matching, not AI, and its checker returns
  "nothing was searched" rather than inventing a verdict. Both are labelled as
  such everywhere they appear. Add a Gemini key in Settings for a real reading.
- **Nothing auto-resolves in the browser.** See the note on source validation
  below. This is correct behavior, not a bug.
- Export writes a raw `.sqlite` file. The JSON export with screenshots is 0.6.
- Pull-to-refresh is not wired, because there is nothing to refresh yet.

## Architecture

```
src/domain/      pure rules, no I/O: state machine, cadence, rubric, scoring, heat
src/data/        driver port, migrations, repositories, row mapping
src/verification/ provider port, prompts, response parsing, Gemini + offline adapters
src/ui/          screens and components
src/lib/         ids, theme
```

`src/domain/` is plain functions over plain objects, so the cadence gate, the
state machine and the hit-rate math are unit-tested without a database or a
network. Those three are where the bugs will live.

The database sits behind `SqlDriver` (`src/data/driver.ts`). Phase 0.6 adds a
Capacitor SQLite implementation behind the same interface; repositories never
learn which one they are talking to.

## Notes for later phases

- **Fonts are loaded from Google Fonts.** Fine in a browser, wrong in an APK
  that may launch offline. Self-host Newsreader and Inter during the Capacitor
  wrap (0.6). The fallback stacks are already in place, so it degrades rather
  than breaks.
- **`sql.js` `export()` closes and reopens the database**, which silently ends
  any open transaction. `SqlJsDriver` never persists mid-transaction. Keep that
  invariant if you touch the driver.
- **Criteria freeze on the first check**, which cannot happen yet, so 0.1 also
  treats resolution as a freeze. Once checks exist, `criteria_frozen_at` is the
  real gate.
- **Unlayered CSS beats layered Tailwind utilities.** All custom CSS lives in
  `@layer base` / `@layer components` for this reason.
- **The API key never touches the database.** Settings exports the whole SQLite
  file, so credentials live in `src/lib/keyStore.ts` (localStorage today,
  Android Keystore in 0.6) and nowhere else.
- **A declared response schema is not a guarantee.** `parseStructuredPrediction`
  validates and repairs every model response regardless, and separates repairs
  the user should see (warnings) from responses that cannot be stored.
- **Gemini rejects a declared `responseSchema` alongside a tool**, so the check
  call asks for the JSON shape in the prompt instead and the parser does all the
  enforcing.
- **Source validation cannot work in a browser.** A cross-origin fetch fails
  identically whether the host is dead or simply refuses the browser, so
  `BrowserPageFetcher` reports every failure as `blocked` rather than
  `unreachable`. Blocked earns no validation points, which caps a check at 80 and
  sends it to the approval queue, but it never trips the invented-citation gate.
  Calling a real citation invented is the one mistake this layer exists to
  prevent. The native fetcher (Capacitor HTTP, 0.6) sees real status codes and
  the gate starts biting.
- **A failed check must not consume the cadence slot.** Otherwise one bad key
  quietly pushes every prediction a full interval into the future.
- **The notification plan is replaced, never incremented.** Android battery
  managers drop scheduled alarms, so the whole plan is recomputed and re-armed
  on every change; stable ids make that idempotent.
- **Shared state belongs in one place.** Notification preferences were briefly
  held in two `useState` copies of the same row, which looked identical and
  silently diverged. They live in the query cache now.
