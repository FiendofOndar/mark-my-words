# Mark My Words

A ledger for predictions and the people who make them. See [SPEC.md](./SPEC.md).

## Phase 0.6 (current)

Everything, wrapped for Android. A statement goes in from the share sheet, a
model drafts testable criteria, you confirm, pulls check it against the world,
notifications reach you when something is due, and you can hand somebody a card
proving it.

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run typecheck
npm run build
```

### Getting the APK

**From CI, with nothing installed locally.** Every push to `main` builds a debug
APK and publishes it to a rolling release, so the download link never changes:

    https://github.com/FiendofOndar/mark-my-words/releases/latest

Open that on the phone, tap the `.apk`, and allow the install when Android asks
about unknown sources. The same file is also attached to the workflow run as an
artifact if you would rather have the zip.

One caveat: a debug APK is signed with a keystore the runner generates fresh
each time, so the signature changes between builds and Android will refuse to
install over the previous one. Uninstall first, or add a stable key (see below).

**Locally**, with Android Studio or the command-line SDK and a JDK 21:

```bash
npm run android:apk    # build, sync, then gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run android:open` opens the project in Android Studio to run it on a
connected device, which is the way to debug the native adapters. After any web
change, `npm run android:sync` copies the built assets into the native project.

**A stable signing key**, once uninstalling on every update gets annoying:

```bash
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048   -validity 10000 -alias markmywords
base64 -w0 release.jks   # put this in a repo secret
```

Then add a `signingConfigs` block to `android/app/build.gradle` reading the
password from an environment variable, and have the workflow write the keystore
out of the secret before `assembleDebug`. Not wired up, because it needs a key
only you should hold.

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
- Author pages and standings, with a five-call floor before anyone is ranked
- Receipt and scorecard cards rendered to PNG at 1080x1350 and handed to the
  share sheet, or downloaded where the platform cannot share files
- Manual entry for all three deadline shapes: fixed date, window, event/race
- Feed sorted by heat, with filter chips and live counts
- Detail screen: quote, verdict or countdown, criteria, actions, amendment log
- Manual resolve into all six states, reopen, late-hit logging
- Amendments that require a reason and show on the record
- Standings with the five-prediction ranking floor
- Dark and light themes, persisted

### What is stubbed

- Nothing in the spec's 1.0 scope, but see the two warnings below.
- **Not one real model call has been made.** Every provider path is covered by
  tests against injected fakes, and the container this was built in has no API
  key. Before trusting a verdict, run:

  ```bash
  GEMINI_API_KEY=... node scripts/validate-gemini.mjs
  ```

  It checks the three things tests cannot: that the model id exists, that the
  grounding tool is still called `google_search`, and that the model's cited
  quotes actually appear on the pages it cites. That last one is the assumption
  the whole anti-hallucination guardrail rests on. Get a free key at
  https://aistudio.google.com/apikey.
- **No native adapter has been run on a device.** The build container has no
  Android SDK (`dl.google.com` is blocked by its egress proxy), so
  `src/platform/` is written to the documented APIs and unverified. It compiles
  and the web build is unaffected, but expect to debug it on first run.
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
src/domain/       pure rules, no I/O: state machine, cadence, rubric, scoring,
                  heat, notification planning
src/data/         driver port, migrations, repositories, row mapping
src/verification/ provider port, prompts, response parsing, source validation,
                  the check orchestrator and the pull
src/notifications/ delivery port, browser notifier, preferences
src/capture/      share target, source archiving and its retry queue
src/receipts/     the shareable cards and their rasterizer
src/platform/     every native adapter, and the only file that knows there are
                  two answers
src/ui/           screens and components
src/lib/          ids, theme, credential storage
```

Every capability the web cannot do properly sits behind a port: the database
image (`Persistence`), page fetching (`PageFetcher`), notification delivery
(`Notifier`), image sharing (`ImageSharer`), credentials (`SecureStore`). The
native build swaps implementations and changes nothing else. sql.js runs in the
Android WebView as-is, so even the database is the same code on both.

`src/domain/` is plain functions over plain objects, so the cadence gate, the
state machine and the hit-rate math are unit-tested without a database or a
network. Those three are where the bugs will live.

The database sits behind `SqlDriver` (`src/data/driver.ts`). Phase 0.6 adds a
Capacitor SQLite implementation behind the same interface; repositories never
learn which one they are talking to.

## Notes for later phases

- **Fonts are self-hosted** in `public/fonts` (latin subsets, ~440 KiB). This is
  not only for offline launch: an SVG `foreignObject` cannot reach an external
  font, so a receipt card rasterized with remote fonts silently comes out in a
  fallback face. Re-run the fetch in the git history if the faces need changing.
- **Do not rasterize a `position: fixed` element.** html-to-image clones the
  node into a `foreignObject`, where a fixed root is taken out of flow and
  renders nothing but the background. `useReceipt` mounts the card inside a
  fixed host and rasterizes the child.
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
