# Mark My Words

A ledger for predictions and the people who make them. See [SPEC.md](./SPEC.md).

## Phase 0.2 (current)

Capture and intake. A statement goes in, a model drafts testable resolution
criteria, you confirm, and the clock starts. No verification, no notifications,
no archiving yet.

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
- Manual entry for all three deadline shapes: fixed date, window, event/race
- Feed sorted by heat, with filter chips and live counts
- Detail screen: quote, verdict or countdown, criteria, actions, amendment log
- Manual resolve into all six states, reopen, late-hit logging
- Amendments that require a reason and show on the record
- Standings with the five-prediction ranking floor
- Dark and light themes, persisted

### What is stubbed

- The check log says so. Verification lands in 0.3.
- The offline drafter is regex pattern matching, not AI. It is labelled as such
  everywhere it appears. Add a Gemini key in Settings for a real reading.
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
