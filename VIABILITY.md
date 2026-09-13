# Viability

Can this app be put in a store, used by people who are not its author, and
paid for without losing money on every user? This document is the standing
answer, and the process for keeping the answer true as the app changes.

Read it before any of the following: distribution work (Play, App Store,
signing, listing), any feature that spends money per user, any change to the
cadence gate or the check prompt, any change to where data lives, and at each
review point in section 6. `CLAUDE.md` holds the engineering rules, `SPEC.md`
the product, `HANDOFF.md` the state. This holds the business and the scale.

It was written on 2026-09-13 against `main` at PR #21 (schema v11, 334 tests,
all passing when run this session: 23 files, 334 tests). Every factual claim
below says where it came from: a file read in this repository, a page fetched
or a search result seen this session, a measurement run this session, or
memory. Memory is marked and is a hypothesis until someone checks it.

The same rules as `CLAUDE.md` apply to editing this file: fix the record in
the same commit that makes it stale, label the basis of every number, and
never invent a figure to fill a blank. A blank is more useful than a guess.

---

## 0. The short version

**The app as built cannot go in a store.** Not because of quality; the
pipeline is correct on every live fixture. Because of three structural facts,
each of which is a rewrite of a layer rather than a fix:

1. **Every check is billed to a Google API key the user pastes in.** Almost
   nobody who installs from a store has one, and the app does nothing useful
   without it (the offline drafter is regex). The spec saw this coming in
   section 11.4. The answer is a thin server that holds one key and meters
   users, and it is the first real piece of infrastructure this project will
   run. Everything about cost, abuse and revenue routes through it.

2. **The ledger lives on one phone with no way back.** The product's promise
   is the receipt years later. Today a lost or replaced phone loses every
   receipt, the only export is a raw SQLite download with no import path, and
   Android's automatic backup silently stops once the file passes 25 MB, which
   this app reaches at roughly 250 predictions of history (measured this
   session, section 2.2). Backup, then sync, is a viability requirement, not a
   feature.

3. **The expensive call is being used as a poller.** The check prompt says
   most checks should return `no_change`, and the cadence gate schedules 22 to
   42 grounded checks over the life of a one- to two-year claim (modelled this
   session from `src/domain/cadence.ts`, section 3.2). Each is a full grounded
   model call. The unit economics only work if the "has anything happened
   yet?" question is answered by something cheaper most of the time.

Beyond those three, the store list is long but ordinary: release signing,
a privacy policy and data-safety disclosure for text that leaves the device,
crash reporting so the first thousand users are not invisible, versioning,
and the hosted receipt link that turns a shared image into an acquisition
channel.

**On money.** The recommendation is a one-time trial allowance of hosted
checks, a subscription above it priced around the productivity-app median
the research in section 4 found ($24.95 a year, with a monthly plan beside
it), and bring-your-own-key kept as the free, unlimited escape hatch for the
people who already have keys. Consumable check packs are the second lever
if usage turns out to be lumpy. What is not recommended: a monthly free tier
(at benchmark conversion it costs more than the payers bring in), a one-time
purchase (the cost is recurring), ads (the audience is small and the surface
is a ledger), or shipping the store build with the paid key bundled in the
APK (it will be extracted within a week).

The arithmetic in section 4.4 is the finding to sit with: on the current
model family, past the free grounding pool, a regular user's checks cost
about $1.28 a month against about $1.77 net from the annual price. With the
two-stage check that drops to about $0.43, and the hosted tier roughly pays
for itself. Without it, the hosted tier loses money at every scale. This is
a small business at best, in a category where four apps in five never
reach $1,000 a month; the thing that would make it more is the shareable
receipt page, which costs nothing per user.

**On being right without the owner watching.** Every wrong verdict so far
was caught by the owner reading screenshots. A thousand users are not going
to do that, and a wrong verdict on someone's bet is the one failure the app
cannot survive on reputation. Section 2.9 has the small instrument that
replaces the screenshots.

**On scale.** Nothing in the app itself has a multi-user scaling problem,
because there are no multi-user parts. The scaling risks are per device (the
database engine and backup cap) and per dollar (the check cost). The server
that has to exist for the store is small: it forwards one request per check,
enforces a budget, and records a line. It is the abuse surface, not the
compute, that needs design.

The rest of this document is the evidence, the arithmetic, the plan, and the
checklist that keeps the plan honest.

---

## 1. Where the app stands, in facts

Read from the repository this session unless marked otherwise.

**Shape.** React 19, TypeScript, Vite, Tailwind 4, Capacitor 8. Android only.
Whole history is one day: 136 commits on 2026-09-13. Single user, single
device, no account, no server, no analytics, no crash reporting (a grep for
analytics, telemetry, Sentry and PostHog finds nothing in `src/`).

**The model call.** `GeminiVerifier.check` is one `generateContent` request
with `tools: [{ google_search: {} }]`, a 90 second timeout, temperature 0.1,
against the alias `gemini-flash-latest`. The system prompt is about 11 KB of
instructions; the intake prompt about 7 KB. `runPull` is the only caller,
budgeted at six checks per pull, spaced 6.5 seconds, under a daily ceiling
that defaults to 20 and a cooldown on any 429.

**The key.** Pasted in Settings, held in Android Keystore-backed storage
(`src/lib/keyStore.ts`, `src/platform/secureStore.ts`), never written to the
database. With no key, `createVerifier` returns `MockVerifier`, whose drafter
is regex and whose checker returns "nothing was searched".

**The database.** sql.js (SQLite compiled to WebAssembly) running inside the
WebView on both web and Android. On Android the whole image is re-exported
and rewritten as a base64 text file in the app's data directory on every
debounced write (`FilesystemPersistence`, 250 ms debounce, `SqlJsDriver`).
`@capacitor-community/sqlite` is a dependency and has a block in
`capacitor.config.ts`, but nothing in `src/` imports it.

**Backup.** `AndroidManifest.xml` has `allowBackup="true"` and no backup
rules. Settings offers "Export database file", which triggers a raw `.sqlite`
download via an anchor click. There is no import. The spec's JSON export and
import (section 10.6) are not built; the README says they "arrive in 0.6".

**Notifications.** Local only, the plan replaced on every change. No push
service. This costs nothing at any scale and should stay that way.

**Network.** The device talks to `generativelanguage.googleapis.com`, to
`web.archive.org` and `archive.ph` for source archiving, and to every cited
URL to check that it answers (up to `MAX_SOURCES = 8` per check). All from
the user's own IP.

**Release.** CI builds a debug APK signed with a throwaway key on every push
to `main` and replaces a rolling GitHub release. `versionCode 1`,
`versionName "1.0"` are hardcoded in `android/app/build.gradle`;
`package.json` says `0.1.0`. There is no release signing configuration.

**Android-only pieces.** The share target (`send-intent`, with a patched
`build.gradle`, and the manifest intent filters). Everything else behind a
port has an iOS implementation according to its plugin's own documentation;
see section 4.1a for what was and was not verified.

**Stale record.** `README.md` still says no real model call has been made,
that cited pages are searched for the quoted passage, that an evidence rubric
scores each check, and that criteria freeze on first check. `HANDOFF.md` and
`CLAUDE.md` contradict all four. It is listed in section 8 as a fix for the
main branch, not made here, because this branch is planning only.

---

## 2. What has to change before a store, ranked

Ranked by how much of the app each one touches, most first. Items 2.1 to 2.3
are architectural. The rest are work.

### 2.1 The key: from bring-your-own to a metered proxy

**The problem.** A store user will not obtain a Gemini API key, enable
billing on it, and paste it in. Requiring that caps the audience at people who
already have keys, which is a hobbyist audience measured in hundreds, and it
exposes the listing to review risk on both stores for "does not function
without an external account" (see section 4.1a for what the store rules
say; that phrase is the risk, not a quoted rule, and neither store
was found to have ruled on it either way). Bundling the
owner's key in the APK is not an option: a key in a shipped binary is
extracted by anyone who wants it, and the $25 monthly cap becomes someone
else's budget.

**The change.** A small HTTPS service that holds the key and exposes two
routes mirroring the `Verifier` port: `structure` and `check`. The device
sends what it sends Gemini today, minus the key; the service adds the key,
forwards, and returns the response unchanged. The client change is a second
`Verifier` implementation (`ProxyVerifier`) selected by `registry.ts`; the
spec called this "a transport swap rather than a rewrite" and that is still
true on the client side.

The server side is where the design lives, and every item on this list is
about money rather than compute:

- **Identity without accounts.** Each install gets an opaque device id at
  first launch. The service keys budgets on it. Accounts come later (2.2) and
  attach to the same id.
- **Attestation.** A device id alone can be minted by a script. Play
  Integrity (Android) and App Attest (iOS) let the service refuse requests
  that did not come from the real app on a real device. No fee was found for
  either, and Play Integrity has a default quota of 10,000 requests a day
  (section 3.4). Without this, the hosted key is one curl loop away from
  the monthly cap.
- **Budgets in three rings.** Per device per day, per device per month, and
  a global kill switch tied to the provider bill. All three enforced on the
  server; the client's own daily ceiling and pull budget stay as the polite
  layer.
- **Entitlements.** Free tier allowance per device; a paid allowance when a
  store purchase is verified (section 4.2). The service checks the receipt
  with the store's API, not the client's word.
- **A line per call.** Device id, timestamp, route, model version, tokens
  in and out, grounding metadata as served, latency, outcome. This is the
  instrument the whole cost model runs on, and the answer to the two open
  questions in `HANDOFF.md` section 5 (what `gemini-flash-latest` resolves
  to, and whether grounding metadata ever arrives). It will answer them on
  the first real request through the proxy.
- **Long requests.** A grounded check has run past 45 seconds on the live
  fixtures (`GeminiVerifier` comment). The host has to hold a request open
  for 90 seconds. That rules out some serverless tiers; section 4.1 has what
  each one allows.
- **Keep BYOK.** A user with their own key bypasses the proxy entirely,
  costs nothing, and is unlimited. It is the power-user tier and the answer
  to "what if the service is down".

**What it costs to run.** Small. Section 3.4 has sourced hosting numbers.
The bill that matters is the provider's, which the proxy makes visible per
user for the first time.

**What reopens this.** Nothing. There is no store path that does not go
through a server holding the key.

### 2.2 The ledger is trapped on one phone

**The problem.** Three facts compound:

- The only export is a raw SQLite file, and there is no import.
- Android's automatic backup covers the app's files directory up to 25 MB
  per app, and past that "no more backups will take place and the last saved
  snapshot will be used" (Android developer documentation on Auto Backup,
  seen in a search result this session; the page itself was not fetched).
  `Directory.Data` in the Capacitor Filesystem plugin is "the directory
  holding application files" on Android (read from the plugin's
  `definitions.d.ts` in `node_modules` this session), which is what Auto
  Backup covers.
- The image grows at about 94 KiB per prediction over its lifetime.
  Measured this session with sql.js: a synthetic database of 1,000
  predictions, each with 25 checks carrying five evidence rows of realistic
  text lengths, exported to 91.4 MiB (121.8 MiB as the base64 file the app
  writes on Android). 25 MB is passed at roughly 250 predictions of history,
  earlier if quoted passages run long.

So a heavy user, the kind who would pay, is the one whose automatic backup
stops working, silently, and who has no other way to move the ledger to a new
phone. The product promise is the receipt years later; this is the thing
that breaks the promise.

**The change, in two steps.**

1. **Backup now.** A JSON export and import (spec 10.6, merge by UUID with
   newest `updated_at` winning) shared through the native share sheet, plus
   a backup rules file that excludes the SQLite image from Auto Backup once
   there is something better, or at least a Settings line saying the
   automatic backup no longer covers the ledger past a size. This is a
   client-only change and belongs before the closed test.
2. **Sync later.** Every table already carries UUIDs, `created_at`,
   `updated_at` and `deleted_at` tombstones for this. Sync needs accounts,
   which is the same identity the proxy needs (2.1), so it lands after the
   proxy and reuses it. Of the sync options priced in section 3.4, PowerSync
   and Turso's sync do offline-first SQLite on the device (fetched from
   their docs); ElectricSQL syncs reads and routes writes through your own
   API; Supabase Postgres and Cloudflare D1 are server databases with no
   device sync. The choice can wait until the proxy has been running.

### 2.3 The database engine

**The problem.** sql.js keeps the whole database in WebView memory and the
only way to save is to export the entire image. `FilesystemPersistence` then
base64-encodes it on the main thread and writes it as text, at 1.33 times the
size. At the seed's size this is nothing, as the code comment says. At the
sizes in 2.2 it is a 10 to 100 MB export and encode on every debounced write,
on the thread that draws the screen. The 25 MB backup cap arrives at about
the same point.

**The change.** `@capacitor-community/sqlite` is already a dependency and
was clearly planned (`androidIsEncryption: false` sits in the config). It
writes to a real SQLite file through native code, page by page, with no
image export. The `SqlDriver` port exists so that this is a second driver,
not a rewrite; the invariants in `CLAUDE.md` about `export()` closing the
database stop applying, and the migrations run unchanged. The web build keeps
sql.js.

**When.** Not before the first users. The trigger is a metric: when the
median ledger passes a few megabytes, or the first jank report arrives, or
before sync (a sync engine wants the native file). Section 7 carries the
number to watch. Doing it now would be building for a scale the app has not
reached, which `CLAUDE.md` warns against for good reason.

### 2.4 The app is invisible once it leaves the owner's phone

Today the test loop is "build, install, screenshot, read". With a hundred
strangers there are no screenshots. Without crash reporting the first
month's failures are one-star reviews and nothing else.

**The change.** Opt-in crash reporting with no personal data (a prediction's
text never leaves the device in a crash report), and a handful of counted
events the cost model needs: check outcome, pull size, ledger row count, app
open. Not a general analytics SDK; a dozen counters. Sentry and PostHog both
have free tiers that cover this scale (memory; verify before choosing, and
record the choice here). The proxy's per-call line (2.1) covers everything
about the model calls, so the client only needs to report what the proxy
cannot see.

### 2.5 Release signing, versioning, and the store build

Every build is a debug APK with a fresh throwaway key, so Android refuses to
install one over another. A store needs one upload key that never changes,
a `versionCode` that increases on every upload, and a release build with
minification on. The README already describes the keystore step and says it
is "not wired up, because it needs a key only you should hold". That is
right: the owner generates it, puts it in a repository secret, and CI signs
with it. Play App Signing then holds the app signing key on Google's side,
which is the recovery path if the upload key is ever lost.

Versioning: derive `versionCode` from the CI run number or a date, and put
`versionName` on `package.json`'s version. Stop hardcoding both.

### 2.6 Privacy policy, disclosure, and what leaves the device

The app sends the user's typed statement, the criteria, and the author's
name to Google's API, the source URL to the Internet Archive, and fetches
every cited page from the device. None of that is hidden, but none of it is
disclosed either. Both stores require a privacy policy URL and a data
disclosure form, and Apple's guideline 5.1.2(i), added 2025-11-13, requires
explicit permission before personal data is shared with "third-party AI",
with forum reports of rejections when the model call can fire before the
consent screen (section 4.1a, fetched). So the first-run screen that says
where text goes and asks before the first model call is a submission
requirement, not a courtesy, and it has to come before the intake call, not
before the first check.

The policy is short because the truth is short: nothing is collected by the
developer today; with the proxy (2.1) the developer sees the statements in
transit and keeps a per-call log without the statement text. Write it that
way and keep it that way.

There is also a product question the review card already half-answers: a
user recording a claim by a named private person ("my neighbor said") is
sending that person's name and claim to a third-party model. The consent
screen covers the rule; the intake prompt does not need to change.

Both stores also need working credentials for the reviewer. With BYOK only,
that is a live key in the review notes, spending the owner's money on the
reviewer's checks. With the proxy, it is a reviewer allowance on a device
id. Another reason the proxy comes first.

### 2.7 The receipt has no link

The receipt card is the app's only outbound surface, and it is a PNG. Someone
who receives it has a picture and no way to install the app, verify the
record, or see the author's standing. The products in section 4.1 with any
visible traction (Manifold's markets, Fatebook's questions) are the ones
where the unit of use is a link.

**The change.** A hosted, public, read-only receipt page: the card's content
rendered at a stable URL, generated when the user chooses to share, with the
store links under it. It needs the same small server as 2.1 and a static
host, and nothing else. Privacy stays intact because sharing is a choice per
receipt. This is the cheapest acquisition channel the app can have, and it is
the only one that does not cost money per user.

### 2.8 iOS

The owner said "App Store". The app is Android, so Google Play is the first
store, and iOS is a second phase with a real bill: $99 a year for the
developer program, a Mac or a rented one to build (Capacitor 8 needs Xcode
26, which needs macOS Tahoe; Codemagic gives 500 free minutes a month), and
a Share Extension target for the capture path, which `send-intent` supports
on iOS with an App Group and a URL scheme (all fetched, section 4.1a). The
domain, data, verification and UI layers do not care which platform they
run on; `src/platform/` and the share target do. Plan iOS after the proxy
and the first Play cohort, not alongside them.

### 2.9 Correctness without the owner watching

Every wrong verdict this project has seen was caught by one person reading
screenshots: the drone strike that predated the claim, the softened
qualifier, the Sea-Tac reading. The gates queue what the app notices and the
model's low confidence; neither catches a confident, well-cited, wrong
answer. At one user that is a review card. At a thousand it is a liability
the app has no way to see.

Two small instruments, both cheap:

- **The six live fixtures as a standing test.** `CLAUDE.md` describes six
  seeded predictions with known outcomes that one pull covers. Run them
  through the proxy on a schedule (weekly is about $0.40 at the prices in
  3.1) and alarm when a verdict differs from the expected one. This is the
  only thing that will notice a model swap behind the alias, a prompt
  regression, or a provider change before users do. It is the one exception
  to "checks are only ever spent by a deliberate tap", it runs on the
  server rather than in the app, and it should be written down in
  `CLAUDE.md` as such when it lands.
- **"This verdict is wrong" on the detail screen.** One tap that flags a
  check, with the option to send the check's inputs and outputs (never the
  user's other data) to the developer. A wrong verdict becomes a fixture,
  which is what `CLAUDE.md`'s "capture the failure before fixing it" needs
  and what the owner's screenshots have been standing in for.

Add the wrong-verdict rate to section 7. It is the quality metric the
business rests on, and today its value is "two, both caught by hand".

---

## 3. Cost structure

### 3.1 What one check costs

Prices below were read this session from Google's Vertex AI / Agent Platform
pricing page (`cloud.google.com/vertex-ai/generative-ai/pricing`, fetched).
The Gemini Developer API's own pricing page is blocked from this container;
third-party pages seen in search snippets quote the same numbers for it, and
the two lists have historically matched, but parity is not verified from the
Developer API page itself. Re-check there before any price goes in a listing.

**Model tokens, per million, global endpoint, up to 200K context.**

| Model | Input | Output | Basis |
|---|---|---|---|
| Gemini 3.8 / 3.7 / 3.6 Flash, through 2026-12-31 | $0.75 | $3.75 | fetched |
| Same models from 2027-01-01 | $1.50 | $7.50 | fetched |
| Gemini 3.5 Flash | $1.50 | $9.00 | fetched |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | fetched |
| Gemini 2.5 Flash (deprecation scheduled 2026-10-16, per a snippet) | $0.30 | $2.50 | fetched; date snippet |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | fetched |

**Grounding with Google Search.** Two schemes, and which one a check lands on
depends on which model the alias resolves to. Quoted from the fetched page:

| Family | Free allowance | Past the allowance | Unit |
|---|---|---|---|
| Gemini 3.x, all models pooled | 5,000 grounding queries **per month** | $14 per 1,000 queries | "charged for each individual Grounding Query performed" |
| Gemini 2.0 Flash, 2.5 Flash, 2.5 Flash-Lite, pooled | 1,500 grounding prompts **per day** | $35 per 1,000 prompts | one charge per prompt "even if multiple Grounding Queries are sent" |

Also from the fetched page: input tokens the grounding tool itself supplies
are not charged, and grounding is billed only when the prompt "successfully
returns sources". Per-query billing on 3.x started 2026-01-05.

This settles the direction of `HANDOFF.md` bug 4 and the "billing unit is
unverified" note in `CLAUDE.md`: the newer family bills per query, the older
per prompt, as the handoff had it. What is not settled is which family
`gemini-flash-latest` resolves to today. Google's docs describe the alias as
hot-swapped on each release with two weeks' notice for breaking changes
(snippet). A fetched GitHub issue from June 2026 shows the alias resolving to
a retired 2.0 model and returning 404. Every check should record
`modelVersion` (it does, on the check log) and the proxy should log it.

**One check, arithmetic from the numbers above.** Assumes about 4,000 input
tokens (an 11 KB system prompt plus the claim, criteria and prior findings)
and 1,000 output tokens; grounding-supplied tokens are free. The app's own
tokens counter in Settings replaces this assumption once there is data.

| Scheme | Tokens | Grounding | Per check | Notes |
|---|---|---|---|---|
| 3.8 Flash, inside 5,000 free queries a month | $0.007 | $0 | about $0.007 | the pool covers about 1,250 checks a month at 4 queries each |
| 3.8 Flash, past the pool, 4 queries | $0.007 | $0.056 | about $0.06 | 4 queries is a guess; the prompt asks for 3 agreeing sources |
| 3.8 Flash, past the pool, 12 queries (prompt ceiling) | $0.007 | $0.168 | about $0.18 | worst case the prompt allows |
| 3.8 Flash from 2027, 4 queries | $0.014 | $0.056 | about $0.07 | token price doubles |
| 2.5 Flash, inside 1,500 free prompts a day | $0.003 | $0 | about $0.003 | 45,000 free grounded checks a month |
| 2.5 Flash, past the allowance | $0.003 | $0.035 | about $0.04 | flat regardless of query count |

An intake (structure) call has no grounding and costs about $0.005 on 3.8
Flash at the same assumptions.

Two things follow. The number of search queries the model runs per check,
which the app has never been able to observe, is now the largest term in the
cost of a check on the current family, and the prompt's "stop at three,
never twelve" is the only thing bounding it. And the free pool shrinks by
roughly thirty-six times moving from the 2.5 scheme (45,000 prompts a month)
to the 3.x scheme (5,000 queries a month), which the scheduled 2.5 Flash
retirement makes the default future.

**What the same job costs elsewhere** (for the pre-check in 3.5 and for the
second provider in Stage 2). Anthropic figures fetched from
`platform.claude.com`; the rest snippet-only, first-party pages blocked.

| Provider | Search | Tokens (in / out per 1M) | Free tier | Basis |
|---|---|---|---|---|
| Anthropic web search + Haiku 4.5 | $10 per 1,000 searches | $1 / $5 | none stated | fetched |
| OpenAI Responses `web_search` + gpt-5-mini | $10 per 1,000 calls plus search content tokens | $0.25 / $2.00 | none stated | snippet |
| Perplexity Sonar | $5 to $12 per 1,000 requests by context size | $1 / $1 | not found | snippet |
| Brave Search API | $5 per 1,000 queries | none | free plan removed Feb 2026; $5 a month of credits | snippet |
| Tavily | $0.008 per credit, basic search 1 credit | none | 1,000 credits a month | free tier fetched; price snippet |
| Exa | $7 per 1,000 searches | none | signup credits | snippet |

A bare search is $0.005 to $0.008. A grounded check past the pool is $0.06
and up. That ratio is what section 3.5 is built on.

### 3.2 How many checks a prediction causes

Modelled this session with a script that mirrors `checkIntervalDays` in
`src/domain/cadence.ts` and simulates a user who pulls once a day or once a
week. Late watch is the rule in `src/domain/prediction.ts`: monthly for
three years after a miss when `canHappenLate` is set.

| Time to deadline | Checks, pulling daily | Checks, pulling weekly |
|---|---|---|
| 7 days | 8 | 2 |
| 30 days | 12 | 5 |
| 90 days | 16 | 9 |
| 180 days | 23 | 15 |
| 1 year | 29 | 22 |
| 2 years | 42 | 32 |
| plus late watch, if it applies | up to 36 | up to 36 |

Add one intake call per capture, two when the review card redrafts.

Two things stand out. The final week is the expensive part: twice-daily
checks on a claim that is about to settle. And late watch on an event-shaped
miss can cost more than the whole open period did. Both are correct product
behavior; both are where a cheaper instrument would pay for itself first.

### 3.3 What a user costs per month

Three usage profiles, chosen for this document (judgment call, section 9):

| Profile | Open predictions | Pulls | Checks per month | Intake calls per month |
|---|---|---|---|---|
| Light | 3 | weekly | about 5 | 1 |
| Regular | 10 | a few a week | about 20 | 3 |
| Heavy | 30, several near deadline | daily | about 60 | 8 |

Cost per month per profile, from the per-check figures in 3.1 (arithmetic
this session; every input is labelled there):

| Profile | 3.8 Flash inside the free pool | 3.8 Flash past the pool, 4 queries | 3.8 Flash past the pool, 12 queries | 2.5 Flash past its allowance |
|---|---|---|---|---|
| Light | $0.04 | $0.32 | $0.88 | $0.19 |
| Regular | $0.16 | $1.28 | $3.52 | $0.77 |
| Heavy | $0.46 | $3.82 | $10.54 | $2.30 |

(Intake calls priced at $0.005 each on 3.8 Flash and $0.003 on 2.5 Flash.)

Read against section 4.3: the research found a median annual price for
productivity apps of $24.95, which is $2.08 a month gross and about $1.77
after a 15 percent store fee. A regular user on the current family, past
the free pool, at four queries per check, costs $1.28. That is a margin of
about fifty cents, and it is negative for the heavy profile at any price
the market pays. At twelve queries a check, every profile loses money.

The free pool changes the picture for the first cohort only: 5,000 queries a
month at four per check is about 1,250 checks, which is roughly sixty regular
users. The sixty-first user is at full price. Plan for the full price.

### 3.4 Fixed costs

Hosting is not where the money goes. Researched this session; most vendor
marketing pages are blocked from this container, so the researcher read the
vendors' documentation from their public GitHub source where possible
(marked fetched) and used search snippets otherwise.

| Item | Cost | Basis |
|---|---|---|
| Cloudflare Workers, the proxy | free plan 100,000 requests a day; paid $5 a month with 10M requests and 30M CPU-ms included; waiting on an upstream call is not billed as CPU | fetched (docs repo) |
| Cloudflare D1 or KV, the metering table | inside the paid plan's included rows at 400,000 calls a month | fetched |
| Supabase, if auth, database and functions come from one vendor | free to 500,000 function calls and 50,000 monthly users; Pro $25 a month; free projects pause when idle | fetched (limits); pause interval snippet |
| Fly.io, a plain VM | about $2 to $4 a month for one or two small machines; no free allowance; card required | machine price snippet; other prices fetched |
| Google Cloud Run, request-based billing | about $1.44 at 100 users but about $55 at 1,000 and about $600 at 10,000, because CPU is billed for the whole time a request waits on the model; instance-based billing is about $50 flat | prices fetched; timeout snippet |
| Vercel Pro | about $21 to $92 a month across the three scales; the Hobby plan is non-commercial | snippet |
| Auth (Firebase, Supabase, Clerk) | $0 to 50,000 monthly users on all three | Firebase and Supabase fetched; Clerk snippet |
| Play Integrity, App Attest, Firebase App Check | no fee found on any page; Play Integrity has a default quota of 10,000 requests a day, raisable by form | quota fetched; "free" is an inference, no page says it |
| RevenueCat, subscription plumbing | free to $2,500 a month of tracked revenue, then 1 percent | snippet |
| App Store Server API, Google Play Developer API | rate limits only, no fee found | Apple fetched; Google snippet |
| Google Play developer account | $25 one-time | snippet |
| Apple developer program | $99 a year | fetched |
| Cloud Mac for iOS builds | Codemagic: 500 free M2 minutes a month for personal accounts, then about $0.10 a minute; GitHub Actions macOS runners about 200 free minutes a month | Codemagic fetched; GitHub multiplier snippet |
| Domain for the privacy policy and receipt pages | about $12 a year | memory; verify at purchase |
| Crash reporting | free tier expected | memory; verify before choosing |

The 90 second hold matters when choosing. Cloudflare's documentation says a
Worker's subrequest has no time limit while the client stays connected, but
two community threads (snippets, could not be opened) report external
fetches cut at 90 to 100 seconds. Supabase's function idle timeout is 150
seconds on the free plan with a fetched discussion reporting cuts at 150 to
200 seconds. Cloud Run and Fly hold as long as needed. Whichever is chosen,
the first thing to test is a real 90 second upstream call, and streaming
the model's response through keeps bytes moving on any of them.

The working assumption for the rest of this document is Cloudflare Workers
at $5 a month with D1 for metering, which is the least operational surface,
and a fallback to Fly if the 90 second cutoff turns out to be real.
Recurring fixed cost before Apple: about $5 to $30 a month.

### 3.5 The structural fix: stop polling with the grounded call

Most checks return `no_change` by design (check prompt rule 10: "Most checks
should return no_change"). Every one of those spent a grounded call to learn
that nothing happened. The cadence gate limits how often the app asks; it
does not make asking cheaper.

The change is a two-stage check. Stage one asks a cheap question: has
anything about this claim been published since the last check? That can be a
plain search API call (section 3.1 has prices for two), or an ungrounded
small-model call over the search results, at a small fraction of a grounded
prompt. Only when stage one says "something new" or the deadline is inside
its final week does stage two run the full grounded check that produces a
verdict and citations. The verdict path does not change; the record does not
change; the gates do not change. What changes is that the expensive
instrument runs when there is something to judge.

This is a domain-layer change (a `preCheck` step ahead of `runCheck`) plus
one more provider port, and it can be tested with fixtures the way everything
in `src/domain/` is. It should not be built until the proxy has logged a
month of real checks, because the ratio of `no_change` to everything else on
real users is the number that says how much it saves. Section 7 tracks the
real figure.

What it is worth, if the ratio is what the prompt intends. Take the regular
profile past the free pool at four queries a check: $1.28 a month. If four
checks in five would have returned `no_change` and the pre-check catches
them at $0.008 a search (Tavily's snippet price; Brave's is $0.005), the
month becomes twenty pre-checks at $0.16 plus four grounded checks at $0.25
plus intake, about $0.43. Three times cheaper, and the heavy profile drops
from $3.82 to about $1.30, which is under the net annual price. The pre-check misses some
events (a search that finds nothing new when something did happen); the
final-week rule, which always runs the full check, bounds how long a miss
can last to the cadence interval, and the deadline-day check is unchanged.

### 3.6 Cost at scale

Arithmetic this session from 3.1, 3.3 and 3.4. Two scenarios, because the
first is the ceiling and the second is the plan.

**Ceiling: every active user is the regular profile on hosted checks, no
metering.** Twenty grounded checks and three intake calls a month each, on
3.8 Flash at four queries a check, 5,000 free queries a month, then $14 per
thousand, plus $5 hosting.

| Active users | Checks a month | Billable queries | Grounding | Tokens and intake | Hosting | Total a month | Per user |
|---|---|---|---|---|---|---|---|
| 100 | 2,000 | 3,000 | $42 | $16 | $5 | about $63 | $0.63 |
| 1,000 | 20,000 | 75,000 | $1,050 | $155 | $5 | about $1,210 | $1.21 |
| 10,000 | 200,000 | 795,000 | $11,130 | $1,550 | $25 | about $12,700 | $1.27 |

**Plan: a small one-time trial allowance for free users, metered; paying
users on the regular profile; the pre-check in 3.5 catching four checks in
five.** Conversion at the freemium benchmark of 2.1 percent (4.3). Free
users cost a bounded one-time amount each rather than a monthly one, so the
table is per month of steady state with the free cost spread over the
cohort.

| Active users | Paying users | Grounded checks a month | Pre-checks a month | Model and search cost | Hosting | Total a month |
|---|---|---|---|---|---|---|
| 1,000 | 21 | about 1,100 | about 5,300 | about $55 | $5 | about $60 |
| 10,000 | 210 | about 11,000 | about 53,000 | about $600 | $25 | about $625 |

(Free users modelled at five checks a month each during their trial, paying
users at twenty; queries inside the 5,000 free pool at the smaller scale.)

Section 4.4 sets these against revenue. The short version is that the
ceiling scenario loses money at every price the market pays, and the plan
scenario is close to break-even, not comfortably past it, which is why the
recommendation in 4.2 is a trial allowance rather than a monthly free tier,
and why the pre-check is in Stage 1 rather than later.

---

## 4. Revenue

### 4.1 The market

Researched this session by web search. Nearly every first-party page (App
Store, Play, RevenueCat, Metaculus, Manifold, Fatebook) is blocked from
this container, so almost every row is from a search snippet rather than a
fetched page; the two exceptions are marked. Rating counts and prices that
could not be sourced say "not found" rather than a guess. The competitor
list should be re-run each quarter (section 6); products in this niche
appear and vanish within a year.

**Direct competitors: personal prediction trackers.**

| Product | What it does | Platform, price | Traction | Verifies against the world? | Basis |
|---|---|---|---|---|---|
| Fatebook (Sage, a nonprofit) | Log a prediction with a probability, get reminded at resolution, grade it yourself; Brier score and calibration chart | Web, Slack, Chrome, Discord; free | 63 GitHub stars; about 50,000 forecasts by end of 2023; PredictionBook redirected its users here | No, self-graded | GitHub fetched; rest snippet |
| PredictionBook (Bellroy) | The original calibration tracker, 2008 on | Web; free | Dead. Read-only January 2024, shut a year later: "current level of active users does not justify the resources" | No | fetched (GitHub issue) |
| Metaculus | Community forecasting; staff write and resolve questions | Web; free to forecasters, revenue from partnerships and grants | 3.75M predictions claimed | Humans resolve from publications | snippet |
| Manifold Markets | Play-money prediction market; creators resolve their own markets | Web, iOS, Android; free, optional mana purchases | $2M seed in 2022; 2,000+ daily users in early 2024; mana sales reportedly small after sweepstakes ended in 2025 | No, creator resolves | snippet |
| Foresee: Predictions Tracker; Prediction Tracker & Journal | Personal journal with confidence, arguments, calibration curve | iOS; free with a premium subscription, $0.99 to $14.99 in-app prices | "Not enough ratings to display" | No | snippet |
| ClaimCheck, myPredictions, I told you I was right, Called It, IKEMIND | Small personal or friend-group trackers, all 2020 to 2026 | iOS; prices mostly not found | Too few ratings to display | No (one takes user-uploaded proof) | snippet |
| Told You So! Share Predictions | "Datestamped receipts" of predictions, shareable to social media. Closest to this app's receipt idea | iOS, Android; price not found | Not found | No | snippet |
| Betcha Game / Betcha: Dumb Bets with Friends | Say a bet in your own words, "house AI turns it into a fair contract with clear terms and a deadline", settled by photo evidence, votes, or "the Oracle, which checks the real world all by itself" | iOS (one sibling on Android); free, play coins | "Not enough ratings"; updated through August 2026 | Claims yes (AI contract plus an Oracle). No visible evidence trail, frozen criteria, or approval step | snippet |
| WagerLab | Friendly sports betting with fake units and live odds | iOS, Android; free | About 300,000 Android installs; 4.6 stars from about 780 reviews on a third-party site | Sports results only | snippet |
| PredictCheck | Attribute a public figure's prediction, crowd validates it later, reliability leaderboard | Android; free | Updated November 2025; downloads not found | Crowd | snippet |
| Prophecy Social (a blockchain game) | "Multiple independent AI agents pull evidence from news APIs" to resolve | Web3; free to play | Not found | Claims AI-agent resolution | snippet |

Of about twenty products found, two claim automated resolution against the
real world, both launched in 2025 or 2026, both group-betting games, neither
showing citations, a frozen-criteria step, or a human gate. Everyone else is
self-graded. The LessWrong community, which cares most about this, has
written up self-grading bias and vague criteria as the unsolved problems
(snippet: "Grading your own predictions: the parts I couldn't solve"). That
is the gap this app sits in, and it is real. It is also small: no personal
tracker found has visible traction except a free charity (Fatebook) and a
free sports app (WagerLab).

**Pundit accountability.** Attempted repeatedly since 2012 (PunditTracker,
PunditHawk, PredictCheck, trackrecord.info), always free, always a side
project, and each one died when the operator stopped resolving claims by
hand; trackrecord.info is alive in 2026 and has narrowed itself to one
tournament to keep resolution tractable. Long Bets (Long Now Foundation)
survives on a $50 publication fee and $200 minimum stakes to charity. A
Hacker News thread asked for a pundit prediction tracker in 2012. The demand
is old and unmet, nobody has paid for it, and the missing piece each time
was automated resolution, which is what this app's pipeline is. Note it as a
later direction, not a first product (4.2).

**Adjacent markets that do make money.**

- Real-money prediction markets: Polymarket and Kalshi reached multi-billion
  dollar annualized fee revenue in 2026 (snippets from Sacra, Yahoo Finance,
  Dealroom). They monetize exchange fees on money at stake, briefly topped
  the iOS free chart around the November 2024 election, and had fallen to
  tens of thousands of daily users by mid-2026 (Appfigures snippet). The
  word "prediction" is mainstream; the attention is on money markets.
- Commitment apps with money at stake: Beeminder ($8 a month and up, revenue
  mainly from pledges), Forfeit (about $7 a month, stakes on tasks, photo or
  GPS proof judged by AI or a human, claims 20,000+ users), StickK, Pledgd
  ($15 a month). Forfeit is the closest monetized analogue of "evidence,
  judged by AI, with a human gate", and it charges for consequences rather
  than for the record.
- AI fact-checking: Originality.ai ($14.95 a month for 2,000 credits),
  Factiverse (about €10 a month), and a grey market of weekly-subscription
  iOS "fact checker" apps at $4 to $8 a week. PolitiFact is donor-funded.

### 4.1a The rules and the bill

Researched this session. Apple's guidelines, developer news, and plugin
documentation were fetched (marked fetched). Every Google Play help page is
blocked from this container, so every Play claim is from a search snippet
and must be read on `support.google.com` before it decides anything.

**Google Play.**

| Rule | Finding | Basis |
|---|---|---|
| Developer account | $25 one-time | snippet |
| Closed testing for personal accounts created after 2023-11-13 | At least 12 testers opted in continuously for at least 14 days, then apply for production access; per app; organization accounts exempt; reduced from 20 testers in December 2024 | snippet |
| Identity verification | Legal name, address, email, phone; government ID if the payments profile is not verified | snippet |
| Target API level | New apps and updates must target API 36 since 2026-08-31. Capacitor 8 defaults to 36, and `android/variables.gradle` in this repo is at 36 | fetched (Android docs, Capacitor docs); repo |
| App signing | Play App Signing required; upload an AAB with your upload key, Google holds the signing key | fetched |
| Data safety form and privacy policy | Mandatory for every app. "Collected" means transmitted off the device, including to a third party; ephemeral processing still has to be entered. Third-party AI integrations fall under the User Data policy's disclosure and consent requirements | snippet |
| Apps that need a key from elsewhere | No policy found either way. What applies is the app-access declaration: reviewers must be given working credentials, kept valid. That means a live key in the review notes, which spends money | snippet |
| AI-generated content policy | Exists, with a self-declaration in the console and requirements for reporting and blocking. Whether a verdict and a one-line summary count as "generated content" is not settled by any text found | snippet |
| Service fee | Until 2026-06-30: 15 percent on the first $1M and on subscriptions. From 2026-06-30 in the US, EEA and UK: 10 percent service fee on subscriptions and the first $1M whatever the billing route, plus a 5 percent billing fee when Play's billing is used. Fifteen percent effective for a Play-billed subscription | snippet (Google's post is blocked) |
| Android developer verification | A separate program covering all apps including sideloaded ones: live in four countries from 2026-09-30, global in 2027; Play Console developers are registered automatically | fetched |

**Apple App Store.**

| Rule | Finding | Basis |
|---|---|---|
| Developer program | $99 per membership year | fetched |
| Build machine | Capacitor 8 needs Xcode 26 or later, which needs macOS Tahoe; a Mac, owned or rented, is required. Codemagic gives personal accounts 500 free minutes a month on M2 machines, then about $0.10 a minute. GitHub Actions macOS runners consume free minutes at ten times the rate (about 200 free macOS minutes a month) | fetched (Capacitor, Xcode, Codemagic); GitHub multiplier snippet |
| 3.1.1 In-app purchase | "If you want to unlock features or functionality within your app (by way of example: subscriptions...) you must use in-app purchase." A subscription for hosted checks goes through IAP | fetched |
| 3.1.1(a) and 3.1.3, US storefront | Buttons and links to external purchase are allowed on the US storefront without an entitlement; Apple currently collects nothing on them, has proposed a fee, and litigation continues. A Stripe link-out is possible today for US users, with a fee of undetermined size probable | fetched (guidelines, Apple news); litigation snippets |
| BYOK | No guideline addresses it. The nearest text, 3.1.3(f), allows free companions to paid web tools "provided there is no purchasing inside the app, or calls to action for purchase outside of the app". A reviewer could read "paste your key to enable checks" as a license-key unlock; no report of that happening was found. Also: apps using a third-party service must be "specifically permitted to do so under the service's terms of use"; the Gemini API terms for third-party apps on a user's key were not checked | fetched (guidelines); terms unchecked |
| 2.1, 2.3.1 Review access | Submissions must be "fully functional" with demo credentials and specific notes. Expect to hand Apple a working key | fetched |
| 4.2 Minimum functionality | Must work "on its own without requiring installation of another app". Nothing about backends or keys. Recording and settling predictions with no key is the defence | fetched |
| 5.1.1, 5.1.2(i) Privacy | Privacy policy link in App Store Connect and in the app. "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." Added 2025-11-13. Forum reports of rejections when the AI call can fire before the consent screen | fetched (guidelines, Apple news); forum snippets |
| Privacy nutrition labels | Required. "Collect" means transmitted off device beyond real-time servicing; the optional-disclosure exemption needs the data to be outside the app's primary function, and checks are the primary function, so the prediction text is declared | fetched |
| AI-generated content labelling | No Apple rule found beyond the 5.1.2(i) consent sentence. Blogs claiming one did not cite Apple text | fetched |
| Small Business Program | 15 percent for developers under $1M in the prior year; new developers qualify | fetched |

**Capacitor plugins on iOS** (plugin documentation, fetched from the
plugins' repositories).

| Plugin | iOS |
|---|---|
| `send-intent` (share target) | Supported, but needs a Share Extension target, an App Group and a URL scheme; a cold-start listener caveat. The README now names a Capacitor 8 package under a new scope; this repo has `send-intent ^7.0.0` with a patched `build.gradle`. Check which fork is current before the iOS work |
| `capacitor-secure-storage-plugin` | Keychain; data survives uninstall unless cleared |
| `@capacitor/local-notifications` | Supported. Channels, exact alarms and `allowWhileIdle` are Android-only. A 64-pending-notification limit on iOS is memory, not verified |
| `@capacitor/share`, `@capacitor/filesystem`, `@capacitor/browser`, `CapacitorHttp` | Supported. Filesystem needs a privacy manifest entry and two Info.plist keys for Documents visibility |
| sql.js in WKWebView | No documented ceiling; WebContent processes are killed under memory pressure without published numbers. At ledger sizes measured in megabytes this is not the practical risk; 2.3 is |

**Payments plumbing.** RevenueCat has an official Capacitor SDK and is free
to $2,500 a month of tracked revenue, then 1 percent (snippet). Stripe for a
US link-out is 2.9 percent plus 30 cents per charge, plus 0.7 percent for
Billing (snippet). Direct Play Billing and StoreKit 2 are the store fees
alone and need a plugin.

**Identity, sync, attestation, hosting** are in 3.4. The one rule that is
not a fee: Apple's 4.8 no longer mandates Sign in with Apple outright, but if
any third-party login is offered, an equivalent private option must be too
(fetched). Email-only accounts, or no accounts, avoid it.

### 4.2 Models considered

**Recommended: a one-time trial allowance of hosted checks, a subscription
above it, and bring-your-own-key kept free.** A new install gets enough
hosted checks to see a few verdicts (on the order of fifteen, a judgment
call in section 9), not a monthly refill. Past that, a subscription for
hosted checks, and the existing key field for anyone who wants to pay
Google directly. This matches the cost shape (recurring, per check), keeps
the listing functional without a purchase (recording, settling by hand,
receipts and standings all work with no key and no subscription, which is
what both stores' minimum-functionality rules look for), and turns the
hobbyist audience into a free support tier rather than a lost one.

Why a trial allowance and not a monthly free tier: section 4.4. At the
freemium benchmark conversion, a monthly refill of hosted checks for free
users costs more than the paying users bring in, at every scale, even with
the pre-check. A one-time allowance bounds what a free user can ever cost.

**Second lever: check packs.** A consumable purchase of N checks for people
whose use is lumpy (a friend group during a season). Aligns cost to revenue
exactly. Adds a second SKU to explain; hold it until the subscription has
data.

**Not recommended.**
- *One-time purchase.* The cost is recurring; a one-time price either
  overcharges the light user or funds the heavy one forever.
- *Ads.* The audience is small and the surface is a personal ledger.
- *Bundled key.* Extracted from the APK within days; the cap becomes someone
  else's budget.
- *Free with no hosted checks.* Functional but useless to the store audience;
  this is the status quo with a listing.

**Later, if the network forms.** Public author pages (the pundit
accountability ledger the spec deferred) are a different product with a
different cost structure and a real moderation burden. Section 4.1 records
what happened to the products that tried it. Do not start there.

### 4.3 Price and conversion

Benchmarks are from RevenueCat's State of Subscription Apps 2026 (a dataset
of 115,000+ apps), as relayed by search snippets and secondary write-ups;
`revenuecat.com` is blocked from this container and the report itself was
not read. Treat each figure as approximately right and re-read the report
before setting a price.

| Benchmark | Figure | Basis |
|---|---|---|
| Download to paid by day 35, freemium | 2.1 percent | snippet |
| Download to paid by day 35, hard paywall | 10.7 percent | snippet |
| Trial to paid, trials of 17 to 32 days | 42.5 percent median | snippet |
| Year-one retention, annual plans | 36 percent | snippet |
| Year-one retention, monthly plans | 23 percent | snippet |
| Median annual price, Productivity | $24.95 | snippet |
| Share of Productivity revenue from monthly plans | 77 percent | snippet |
| Median subscription app revenue | $492 a month, down 22 percent year on year | snippet |
| New apps reaching $1,000 monthly revenue within two years | 17.3 percent | snippet |
| New apps reaching $10,000 monthly revenue within two years | 4.6 percent | snippet |
| Share of all revenue taken by the top 10 percent of apps | 94.5 percent | snippet |

One snippet quoted a different cohort figure ("median $8,300 a month after
18 months") from an earlier report that conflicts with the $492 median; it
could not be reconciled without the PDF and is not used.

**What this means for the price.** The productivity median of $24.95 a year
is the anchor. A monthly plan around $2.99 to $3.99 should exist because
that category earns most of its revenue monthly, and a free trial of two to
four weeks converts far better than a short one. The store fee assumed in
this document is 15 percent (the small-developer rate on both stores; the
research in 4.1a is to confirm the current thresholds), which makes the net
on the annual anchor about $1.77 a month and on a $3.49 monthly plan about
$2.97.

**What this means for free users.** At a 2 percent freemium conversion,
every paying user is accompanied by roughly fifty free ones. If each free
user were allowed the regular profile's twenty hosted checks a month, the
free users would cost about $64 a month for every $1.77 of net revenue.
Even five a month each is $16 against $1.77. So the free allowance is a
one-time trial (4.2), sized to show a few verdicts, and its whole cost is
paid once per install: about $0.95 for fifteen checks at the 3.8 Flash
full price, about $0.30 with the pre-check. Two things soften it further:
the 5,000 free grounding queries a month cover the first cohort entirely,
and most installs never spend their allowance.

**The honest read of the benchmarks.** Four apps in five never reach $1,000
a month. This one has a real and documented gap to fill, a cost per user
that can be made small, and no acquisition channel yet. The hosted receipt
(2.7) is the acquisition channel. Without it the numbers above describe an
app that a few hundred people like.

### 4.4 Break-even

Arithmetic this session from 3.1 to 3.6 and 4.3. Every input is labelled
where it first appears; the conclusions are only as good as the snippet
benchmarks and the four-queries-a-check guess.

**Fixed costs are not the problem.** At $5 to $30 a month, three to
seventeen subscribers on the net monthly price cover them.

**Margin per paying user, per month.**

| Situation | Net price | Model cost (regular profile) | Margin |
|---|---|---|---|
| Annual plan at the $24.95 anchor, current family past the pool, no pre-check | $1.77 | $1.28 | $0.49 |
| Annual plan, with the pre-check | $1.77 | $0.43 | $1.34 |
| Monthly plan at $3.49, no pre-check | $2.97 | $1.28 | $1.69 |
| Monthly plan at $3.49, with the pre-check | $2.97 | $0.43 | $2.54 |
| Any plan, heavy profile, no pre-check | $1.77 to $2.97 | $3.82 | negative |
| Any plan, twelve queries a check, no pre-check | $1.77 to $2.97 | $3.52 | negative |

**What a paying user costs to find.** At 2.1 percent freemium conversion,
each paying user arrives with about forty-seven free users who never pay.
If each free user spends a fifteen-check trial allowance, that is about
$45 of grounded checks per paying user without the pre-check, about $14
with it. Set against year-one retention of 36 percent on annual plans and
23 percent on monthly, a paying user is worth on the order of $10 to $15 of
margin over their life with the pre-check, and less than the cost of
finding them without it.

So: **with the pre-check and a small one-time trial allowance, the hosted
tier roughly pays for itself and no more. Without the pre-check it loses
money at any scale.** That is the finding of this document on money, and it
is the reason the roadmap gates the paid tier behind a month of real
`no_change` data rather than launching it with the closed test.

**What would change it.**
- A conversion rate among *active* users well above the download-to-paid
  benchmark. Plausible for a tool people open with a purpose, unsourced, and
  measurable in Stage 0.
- The hosted receipt page (2.7) bringing installs at zero marginal cost.
- The 2.5 scheme's 1,500 free grounded prompts a day, if the alias resolves
  there for the remaining weeks before its retirement; a windfall, not a
  plan.
- A per-query price cut or a larger free pool from Google; watch 3.1.
- Check packs (4.2) for heavy users, so the heavy profile funds itself
  instead of being subsidized by the annual plan.

**What does not change it.** Cutting the cadence. It is already
product-motivated, and the checks that cost the most (final week, late
watch) are the ones users are waiting for.

---

## 5. Roadmap with gates

Each stage has an entry condition and an exit condition. Nothing in a later
stage starts before the earlier stage's exit condition is met, because every
stage's design depends on a number the previous stage produces.

### Stage 0: the closed test (now to the first outside users)

Entry: this document adopted on `main`.

Build:
- Release signing with a stable upload key in CI; `versionCode` from CI;
  `versionName` from `package.json` (2.5).
- Privacy policy page and first-run "where your text goes" screen (2.6).
- JSON export and import through the share sheet (2.2 step 1).
- Crash reporting, opt-in, no content (2.4).
- The proxy, minimum version: device id, per-device daily and monthly
  budget, global kill switch, a line per call, BYOK bypass (2.1). No
  payments yet; every tester is on the free allowance.
- Play Console account ($25), listing, data safety form; closed testing
  track with at least 12 testers opted in for 14 continuous days, which is
  what a personal account created after November 2023 needs before it can
  apply for production (4.1a, snippet; read the help page first).
- A reviewer allowance on the proxy, so review access does not mean a live
  key in the notes.
- Fix the stale README (section 8).

Exit: the closed test has run for the required period, the proxy has logged
at least a month of real checks, and section 7's blank cells for cost per
check, checks per user, and `no_change` ratio have real values.

Predicted outcome, so the stage is testable: at the end of it the provider
bill and the proxy's own totals agree to within a few percent, the observed
queries per check is a number rather than a guess, and the `no_change`
share is known. If any of those three is still blank, Stage 1 does not
start.

### Stage 1: economics (first hundred users)

Entry: Stage 0 exit.

Build:
- The two-stage check (3.5), sized from the real `no_change` ratio.
- Store billing: one subscription SKU, receipt verification on the proxy,
  entitlement to a larger allowance (4.2). Price from 4.3, revisited after
  the first month of data.
- The hosted receipt page (2.7).
- Attestation on the proxy (2.1), before the paid tier goes live.

Exit: cost per paying user per month is known from the provider bill, not
from a model; margin per subscriber is positive under the observed billing
unit; the kill switch has been tested by tripping it.

### Stage 2: durability (first thousand)

Entry: Stage 1 exit and either the median ledger size or the first jank
report crosses the threshold in section 7.

Build:
- Native SQLite driver behind `SqlDriver` (2.3).
- Accounts attached to the device id; sync using one of the options in 3.4
  (2.2 step 2).
- The standing fixture run and the wrong-verdict flag (2.9), if not already
  in Stage 1.
- Check packs if usage is lumpy (4.2).
- Second provider behind the `Verifier` port on the proxy, so a model
  retirement or a price change is a config change, not an outage.

Exit: a user has moved phones and kept the ledger; a provider switch has
been rehearsed.

### Stage 3: reach (beyond)

Entry: Stage 2 exit and revenue covering fixed costs for three consecutive
months.

Build:
- iOS (2.8), with the share extension verified first.
- Public author pages only if there is demand from the hosted receipts.

---

## 6. The recurring review

This is the part of the document that does the work. Each list is short on
purpose. If a check is skipped, say so in the commit or the handoff, the same
way `CLAUDE.md` asks for partial work to be reported.

### Before every store release

- `versionCode` increased; `versionName` matches `package.json`.
- Privacy policy still describes what leaves the device. If a new
  host appears in `src/` (grep for `https://`), the policy changed.
- The data safety form still matches the policy.
- The kill switch works (trip it in staging, confirm the client's message).
- The free allowance and the paid allowance in the proxy match the listing.
- No key, token or credential in the built APK (grep the bundle).
- Crash reporting reports nothing that identifies a person or quotes a
  prediction.
- Section 7 updated with the month's numbers.

### Monthly, while there are users

- Provider bill against the proxy's own per-call totals. They should agree;
  if they do not, the billing unit assumption in 3.1 is wrong and this
  document is stale.
- Cost per active user, cost per paying user, and the `no_change` ratio,
  into section 7.
- Median and 95th percentile ledger size, into section 7. Against the 2.3
  and 2.2 thresholds.
- Conversion and churn against the 4.3 benchmarks.
- Anything in section 8 that became verifiable.

### When adding anything that spends money per user

Before the first line of code, write down: which route on the proxy it uses,
how many calls per user per month it adds under the three profiles in 3.3,
what its budget ring is, and what the client shows when the budget is spent.
Add the row to section 7. `CLAUDE.md`'s "name the cost before spending it"
is the same rule at the single-call scale; this is it at the per-user scale.

### When touching the cadence gate or the check prompt

Re-run the cadence model in 3.2 (the script is ten lines; keep it in
`scripts/`) and update the table. Any change to how often or how expensively
the app asks changes 3.3 and 4.4.

### When a provider changes a price, a model name, or a limit

Update 3.1 with the source and date. Re-derive 3.3, 3.6 and 4.4. If the
billing unit changed, the two-stage check's break-even changed with it.

### Quarterly

Re-read section 0 and section 2. For each item, one of: done, still true,
or no longer true (and why). Re-check the competitor table in 4.1; products
in this niche appear and vanish quickly.

---

## 7. Metrics ledger

Numbers the plan depends on. Blank means not yet measurable; a blank is not
permission to guess. Each cell says when and how it was measured.

| Metric | Value | Basis | Threshold that triggers action |
|---|---|---|---|
| Tests passing | 334 of 334 | `npm test`, 2026-09-13, this session | any failure |
| Lifetime checks per prediction, 1 year claim | 22 to 29 | cadence model, 2026-09-13 | change on any cadence edit |
| Image size per prediction lifetime | about 94 KiB | sql.js measurement, 2026-09-13 | re-measure if evidence shape changes |
| Predictions at which Auto Backup stops | about 250 | 25 MB cap (search result) over 94 KiB, 1.33x for base64 | at 100, ship JSON backup (2.2) |
| Median ledger size, real users | | proxy or client counter, after Stage 0 | 5 MB: schedule 2.3 |
| Cost per grounded check, observed | | provider bill over proxy count, monthly | any drift from 3.1 |
| Tokens per check, observed | | proxy log | |
| Searches per check, observed | | grounding metadata, if it arrives | if it never arrives, billing unit is per prompt |
| `no_change` share of checks | | proxy log or check table | sizes the two-stage check (3.5) |
| Checks per active user per month | | proxy log | against the 3.3 profiles |
| Cost per active user per month | | bill over active devices | against price after store cut |
| Cost per paying user per month | | bill over subscribers | must sit under net price |
| Free to paid conversion | | store console | against 4.3 |
| Monthly churn | | store console | against 4.3 |
| Receipts shared per user per month | | client counter | growth lever |
| Model version the alias resolves to | | proxy log `modelVersion` | on change, re-verify 3.1 |
| Trial allowance spent per install | | proxy log | sizes the allowance (4.2) |
| Conversion among active users | | store console over proxy active devices | the number 4.4 most depends on |
| Wrong verdicts | 2, both caught by the owner (HANDOFF.md) | wrong-verdict flag (2.9), fixture run | any fixture mismatch: stop and diagnose |
| Fixture run agreement | 6 of 6 on the last live pull (HANDOFF.md, 2026-09-13) | scheduled run (2.9) | any mismatch |

---

## 8. Open questions and unverified claims

Ordered by how much of the plan rests on them.

1. **Which model family `gemini-flash-latest` resolves to today.** The
   billing schemes themselves are now sourced (3.1, fetched): the 3.x
   family bills per search query, the 2.x family per prompt. What is not
   known is which one a check lands on, and therefore whether a check
   costs about four cents flat or six to eighteen cents depending on how
   many searches the model ran. `HANDOFF.md` bug 4 is the same question
   from the other side. The proxy's first real call answers it; until
   then, `modelVersion` on the check log does.
2. **Searches per check.** The largest term in the cost of a check on the
   current family, never observed (grounding metadata has not arrived on a
   real check). Four is this document's guess. The 5,000-query monthly pool
   and every figure in 3.3, 3.6 and 4.4 move with it.
3. **The Gemini Developer API pricing page.** Blocked from this container;
   3.1 is from the Vertex AI page, which has historically matched. Read the
   Developer API page before any price appears in a listing.
4. **Every Google Play rule.** All Play claims in 4.1a are from search
   snippets because `support.google.com` is blocked here. The 12-tester,
   14-day closed test and the post-June-2026 fee structure both need to be
   read on Google's own pages before they set a date or a price.
5. **Which sync engine.** Deferred to Stage 2 on purpose; the options and
   prices found this session are in 3.4 so the choice starts from sourced
   material.
6. **Whether either store has ever rejected an app for needing a
   user-supplied third-party key.** No rule and no case was found either
   way. The trial allowance makes the question moot for the store build,
   but the Gemini API's own terms on third-party apps using a user's key
   were not checked and should be, for the BYOK path.
6a. **The 90 second hold on Cloudflare Workers.** Documentation says no
   limit; community threads say external fetches die around 90 to 100
   seconds. One empirical test decides it, and the hosting choice with it.
7. **Android Auto Backup behavior for this app specifically.** The 25 MB
   figure and "backups stop" behavior come from a search result, not the
   fetched page, and the app has never been observed hitting it. Verify
   once: fill a test device past the cap, replace the phone, see what
   restores.
8. **Crash reporting vendor and its free tier.** Memory says Sentry and
   PostHog both have one; verify and record before wiring either in.
9. **The stale README on `main`.** Four claims contradicted by `HANDOFF.md`
   and `CLAUDE.md` (section 1). A fix for the main branch, not made on this
   planning branch.
10. **`HANDOFF.md` says the repo-local git identity is set to the personal
    address.** In a fresh container it is `Claude <noreply@anthropic.com>`,
    which is what 87 of the 136 commits carry. The constraint that matters
    (never the work address) holds; the sentence in the handoff does not.

---

## 9. Judgment calls made in this document

Things picked without being specified, listed so they can be argued with.

- The three usage profiles in 3.3 (3, 10 and 30 open predictions; 5, 20 and
  60 checks a month). Chosen to bracket a plausible range; the proxy log
  replaces them.
- Four search queries per check, and 4,000 input plus 1,000 output tokens.
  Neither has been observed. The prompt asks for three agreeing sources and
  allows twelve searches; the tokens counter in Settings will give the
  second number.
- Four checks in five returning `no_change`, for sizing the pre-check in
  3.5. From the prompt's own design ("most checks should return
  no_change"), not from data.
- A fifteen-check trial allowance. Enough to see two or three verdicts on
  short claims; the proxy log will say what installs spend.
- A 15 percent store fee throughout. Apple's Small Business Program rate
  (fetched) and Play's effective rate on a Play-billed subscription
  (snippet).
- Cloudflare Workers as the hosting assumption in 3.4, for least
  operational surface, with Fly as the fallback if the 90 second hold fails.
- The 2.1 percent download-to-paid benchmark applied to active users in 3.6
  and 4.4, which understates conversion among people who open the app on
  purpose. Conservative on purpose; the real figure is in section 7.
- The synthetic ledger shape in 2.2 (25 checks and five evidence rows per
  prediction, 300-character quotes). The per-prediction figure moves with
  how many sources the model cites; `MAX_SOURCES` is 8.
- Google Play before the App Store, because the app is Android and iOS has a
  capture-path unknown (6 in section 8) and a hardware bill.
- The two-stage check (3.5) as the structural cost fix, over reducing cadence
  or raising the price. Cadence is already product-motivated; price is
  bounded by the market in 4.3.
- Free tier plus subscription over check packs as the first SKU. Packs are
  held as the second lever, not rejected.
- Stage 2's trigger as a ledger-size metric rather than a date.
- Accounts deferred to Stage 2, with a device id doing identity work in
  Stages 0 and 1. This is the cheapest version that shows whether the proxy
  economics work, per `CLAUDE.md`'s "cheapest version first".
