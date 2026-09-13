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
all passing when run this session: 23 files, 334 tests), and revised the same
day after the owner decided the shape of the free and paid paths; section 10
records those decisions and the reasons. Every factual claim
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

1. **Every check is billed to a Google API key the user pastes in, and the
   app does nothing useful without one** (the offline drafter is regex). The
   owner's decision (section 10) is that bring-your-own-key stays the
   primary path, because a free Gemini key covers a regular user many times
   over at no cost to anyone. What has to change is everything around it: a
   keyless free layer that is a real product on its own, a guided flow that
   gets a stranger from install to a working key in a few minutes, and a
   small community pool of hosted checks, capped at Google's free allowance,
   so a new user sees real verdicts before fetching a key. That pool is the
   only server this plan needs for the model, and its cost is one dial.

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
   model call. Under the working plan this is no longer a margin question,
   because the user's own key pays, but it is still what decides whether a
   free-tier key (about 20 grounded requests a day, observed) stays inside
   its limit and how far the community pool stretches. The cheap pre-check
   in 3.5 stays on the roadmap for both reasons.

Beyond those three, the store list is long but ordinary: release signing,
a privacy policy and the consent screen Apple now requires before text goes
to a third-party model, crash reporting so the first thousand users are not
invisible, versioning, and the hosted receipt link that turns a shared image
into an acquisition channel.

**On money.** The working plan is a free download with everything a person
needs to record, settle and share a bet free forever, bring-your-own-key
free forever, a community pool of hosted checks capped at the free
allowance, and one purchase: a one-time supporter unlock (around $4.99) for
things that are nice but not core. No subscription, no ads, no paid
download; section 4.2 has the arithmetic against each. The fixed cost of
the whole operation is about $200 a year before Apple and about $300 with,
which is 50 to 70 unlocks a year. This is a free tool with a tip jar shaped
like a feature, and it is meant to be. Section 4.4 shows what a hosted paid
tier would have looked like and why it was declined.

**On being right without the owner watching.** Every wrong verdict so far
was caught by the owner reading screenshots. A thousand users are not going
to do that, and a wrong verdict on someone's bet is the one failure the app
cannot survive on reputation. Section 2.9 has the small instrument that
replaces the screenshots.

**On scale.** Nothing in the app itself has a multi-user scaling problem,
because there are no multi-user parts. The scaling risks are per device (the
database engine and backup cap) and per dollar (the pool). The server that
has to exist is small: a pool proxy with one monthly counter and a static
host for receipt pages. As users grow, the pool runs out earlier in the
month; that is the signal to watch (section 7), and raising the cap has a
known price.

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

### 2.1 The key: bring-your-own stays, with a keyless layer, a guided path, and a capped pool

**The problem.** A store user does not arrive with a Gemini API key, and
today the app is a regex drafter without one. Requiring a key on first run
caps the audience at people who already have keys and invites the review
"I installed it and it wants a Google Cloud account". Bundling the owner's
key in the APK is not an option: a key in a shipped binary is extracted by
anyone who wants it, and the $25 monthly cap becomes someone else's budget.
A hosted paid tier was costed in sections 3.3 to 4.4 and declined (section
10): at benchmark conversion it roughly breaks even and no better.

**Why bring-your-own-key is the right primary path.** The project's own
record (`CLAUDE.md`, from an observed 429 body) is that a free Gemini key
gets about 20 grounded requests a day. That is 600 checks a month, thirty
times the regular profile in 3.3, at no cost to the user and none to the
owner. The whole cost of BYOK is friction, and friction is a design problem.
Two risks ride with it and both are one afternoon of verification (section
8): whether grounding is still available on the free tier at all, and
whether Google's API terms permit a third-party app to run on a user's key.

**The change, in three parts.**

1. **A keyless layer that is a real product.** Recording a claim, drafting
   criteria by hand with a good form, settling it yourself, the amendment
   log, authors and standings, receipts, notifications, export and import.
   Today the keyless path is the regex drafter labelled "not very good"; it
   should become a deliberate manual-first flow, so the app is honest and
   useful with no key and no server. This is also what both stores'
   minimum-functionality rules look for (4.1a).

2. **A guided key flow.** Five screens at most: why a key, what it costs
   (nothing, on the free tier, with the daily limit stated), a deep link to
   Google AI Studio's key page in the Custom Tab, paste detection when the
   user returns, a test call that commits the key (the Settings screen
   already does this last part right). Measure completion; section 7 has
   the row. If fewer than half of the people who start it finish it, the
   flow is the problem to fix before anything else on this list.

3. **A community pool.** A small HTTPS service holding one key and exposing
   the two `Verifier` routes, `structure` and `check`. The device sends what
   it sends Gemini today minus the key; the service adds it, forwards, and
   returns the response unchanged. On the client it is a second `Verifier`
   (`PoolVerifier`) chosen by `registry.ts` when no key is set. The spec
   called this a transport swap and it still is. The server is small and
   every line of it is about money:

   - **One monthly counter, capped at the free allowance.** 5,000 grounding
     queries a month on the 3.x family (3.1, fetched). The pool stops when
     the counter reaches the cap; the app says the month's pool is spent and
     points at the key flow. Cost past the cap is therefore zero unless the
     owner raises it, and raising it has a known price of $14 per 1,000
     queries.
   - **A per-device daily cap** so one install cannot drain the month for
     everyone, and a small lifetime cap per device so the pool is a taste,
     not a substitute for a key. Device id is an opaque value minted at
     first launch; no accounts.
   - **A kill switch** the owner can flip without a release.
   - **A line per call.** Device id, timestamp, route, model version, tokens
     in and out, grounding metadata as served, latency, outcome. This is
     the instrument the cost model runs on, and it answers the two open
     questions in `HANDOFF.md` section 5 (what `gemini-flash-latest`
     resolves to, and whether grounding metadata ever arrives) on the first
     real request.
   - **A reviewer allowance**, so store review does not need a live key in
     the notes.
   - **Long requests.** A grounded check has run past 45 seconds on the live
     fixtures (`GeminiVerifier` comment). The host has to hold a request
     open for 90 seconds; 3.4 has what each one allows.
   - **Not needed under this plan:** attestation, entitlements, receipt
     verification, per-user metering beyond the counters above. The pool is
     shared and capped, so abuse costs the pool a month, not the owner's
     card. If abuse becomes a pattern, Play Integrity is free and can be
     added then (3.4).

**What it costs to run.** The pool's tokens at full use, about $9 a month
(1,250 checks at $0.007), plus hosting at about $5 (3.4). Flat, by design.

**What reopens this.** A wrong answer on either of the two verification
items above. If free keys cannot ground, BYOK means a paid key, and the
audience shrinks to people willing to put a card on file with Google; the
pool becomes the main path and its cap becomes a real budget decision. If
Google's terms forbid third-party apps on user keys, BYOK is off the table
and the hosted tier in 4.4 comes back, with its arithmetic.

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
   attached to the device id the pool already mints (2.1), so it lands
   after the pool and reuses it. Of the sync options priced in section 3.4, PowerSync
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

### 2.10 The word "bet", and the individual-account gambling rule

Researched 2026-09-13 (Apple pages fetched unless marked). This is the one
App Store risk found so far that could stop the listing outright rather
than cost a round of review.

**The rule.** Guideline 5.3 as published covers real-money gaming,
sweepstakes and lotteries, and says nothing about apps that record a wager
between friends. But Apple's age-rating questionnaire (fetched) defines
"Simulated Gambling" as "betting or wagering without using real money",
rates it 13+ when infrequent and 18+ when frequent, and a notice Apple sent
developers in 2018, quoted in its own forums and applied to a dice app with
no currency in 2020 (both threads fetched), said gambling apps, "including
apps that simulate a gambling experience", would only be accepted from
"verified accounts from incorporated business entities", not individual
developers. That sentence is not in the current guidelines and its 2026
status could not be verified. WagerLab, the closest live comparable, is
rated 18+ for "Frequent Simulated Gambling" (snippet).

**Where this app stands.** The product is a ledger of predictions, and the
code says so: "prediction" throughout, "stakes" as an optional free-text
field, and the word "bet" eight times in `src/`, all but one in comments
(the one is a seeded statement; counted this session). No money is handled,
no odds, no counterparties, no payout. The honest age-rating answer is
"Contests" (users compete for rankings, per Apple's definition), infrequent
or frequent, which rates 4+ or 13+, and "Simulated Gambling: none".

**What to do about it.**
- Keep gambling vocabulary out of the listing, the screenshots, the
  keywords and the review notes: predictions, claims, verdicts, standings,
  receipts. Never "bet", "wager", "odds", "betting" in store copy.
- Rate honestly as Contests, not Simulated Gambling, and say in the review
  notes that the app handles no money and no odds and that "stakes" is a
  free-text note. Guideline 2.3.6 (fetched) says to answer the rating
  questions honestly, so this is the true answer, not a dodge.
- Consider whether the `stakes` field earns its place in a store build. It
  is the only thing on screen a reviewer could point to. Keeping it is
  defensible; renaming the label ("What's riding on it") changes nothing
  in substance. Owner's call; recorded as open in section 8.
- The seeded gutters statement ("I bet the neighbors...") is fine as a
  user's own words but is the first thing a reviewer sees on a fresh
  install. Reword the seed or make sure the review build's first screen is
  the consent flow.

If App Review nonetheless classifies the app as simulated gambling on an
individual account, the options are an appeal with the definitions above,
or an LLC, which is a real cost and paperwork the owner has not signed up
for. It is the reason this item is in section 2 and not section 4.

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

These figures are what a hosted paid tier would have had to cover, and they
are why it was declined (section 10). Read against section 4.3: the research
found a median annual price for productivity apps of $24.95, which is $2.08
a month gross and about $1.77 after a 15 percent store fee. A regular user on the current family, past
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

Two tables. The first is what a fully hosted app would cost, kept because it
is the reason the hosted tier was declined. The second is the working plan.

**If every active user were hosted, regular profile, no metering.** Twenty
grounded checks and three intake calls a month each, on 3.8 Flash at four
queries a check, 5,000 free queries a month then $14 per thousand, plus $5
hosting.

| Active users | Checks a month | Billable queries | Grounding | Tokens and intake | Hosting | Total a month | Per user |
|---|---|---|---|---|---|---|---|
| 100 | 2,000 | 3,000 | $42 | $16 | $5 | about $63 | $0.63 |
| 1,000 | 20,000 | 75,000 | $1,050 | $155 | $5 | about $1,210 | $1.21 |
| 10,000 | 200,000 | 795,000 | $11,130 | $1,550 | $25 | about $12,700 | $1.27 |

**The working plan.** Users on their own keys cost the owner nothing. The
pool is capped at the free allowance, so its cost is tokens only and does
not grow with users; what grows is how early in the month it runs out.

| Active users | Pool checks available a month (at 4 queries each) | Pool cost (tokens) | Hosting | Total a month | What changes |
|---|---|---|---|---|---|
| 100 | about 1,250 | about $9 | $5 | about $14 | pool lasts the month if most users have keys |
| 1,000 | about 1,250 | about $9 | $5 | about $14 | pool spent in days unless the per-device caps are tight |
| 10,000 | about 1,250 | about $9 | $5 to $25 | about $14 to $34 | pool is a first-day taste only; the key flow carries the app |

The pre-check in 3.5 stretches the pool three to five times at the same
cost, and it does the same for a user's free-tier daily limit, which is why
it stays on the roadmap under a plan where the owner's margin no longer
depends on it.

If the owner chooses to raise the pool past the free allowance, the price is
$14 per 1,000 queries: about $56 per thousand extra checks at four queries
each. That is the dial section 7 watches.

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
| 3.1.1 In-app purchase | "If you want to unlock features or functionality within your app (by way of example: subscriptions...) you must use in-app purchase." The supporter unlock is a non-consumable IAP for exactly this reason | fetched |
| 3.1.1(a) and 3.1.3, US storefront | Buttons and links to external purchase are allowed on the US storefront without an entitlement; Apple currently collects nothing on them, has proposed a fee, and litigation continues. A Stripe link-out is possible today for US users, with a fee of undetermined size probable | fetched (guidelines, Apple news); litigation snippets |
| BYOK | No guideline addresses it. The nearest text, 3.1.3(f), allows free companions to paid web tools "provided there is no purchasing inside the app, or calls to action for purchase outside of the app". A reviewer could read "paste your key to enable checks" as a license-key unlock; no report of that happening was found. Also: apps using a third-party service must be "specifically permitted to do so under the service's terms of use"; the Gemini API terms for third-party apps on a user's key were not checked | fetched (guidelines); terms unchecked |
| 2.1, 2.3.1 Review access | Submissions must be "fully functional" with demo credentials and specific notes. Expect to hand Apple a working key | fetched |
| 4.2 Minimum functionality | Must work "on its own without requiring installation of another app". Nothing about backends or keys. Recording and settling predictions with no key is the defence | fetched |
| 5.1.1, 5.1.2(i) Privacy | Privacy policy link in App Store Connect and in the app. "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." Added 2025-11-13. Forum reports of rejections when the AI call can fire before the consent screen | fetched (guidelines, Apple news); forum snippets |
| Privacy nutrition labels | Required. "Collect" means transmitted off device beyond real-time servicing; the optional-disclosure exemption needs the data to be outside the app's primary function, and checks are the primary function, so the prediction text is declared | fetched |
| AI-generated content labelling | No Apple rule found beyond the 5.1.2(i) consent sentence. Blogs claiming one did not cite Apple text | fetched |
| Small Business Program | 15 percent for developers under $1M in the prior year; new developers qualify | fetched |

**Apple, the developer side, for a US individual** (researched 2026-09-13;
Apple's own pages fetched unless marked).

| Requirement | What is needed | Hoop or blocker | Basis |
|---|---|---|---|
| Enrollment | $99 a year on a personal credit card; an Apple Account with two-factor on, in the legal name (an alias delays approval); legal name, phone and a street address (no P.O. box); Apple may ask for a photo of government ID | Hoop | fetched |
| Approval time | Apple publishes none; forum threads from 2026 report individual enrollments pending two weeks to three months, some resolved only by asking Apple to call | Blocker in time, not preventable; start it early | fetched (forum threads) |
| D-U-N-S number | Organizations only | None | fetched |
| Public seller name | The individual's legal name is displayed as the seller on every listing; no alias | Hoop; personal account only, never anything work-associated | fetched |
| Paid Apps Agreement | Must be signed and Active before any in-app purchase can be submitted; Active requires tax and banking complete | Blocker for the unlock until done | fetched |
| Tax form | W-9 with a Social Security Number for a US individual | Hoop | fetched |
| Banking | Routing and account number in the enrolled individual's name, entered exactly | Hoop | fetched |
| Payouts | Within 45 days of the end of the fiscal month; Apple's own threshold page says $0.02 for a US dollar account (the widely repeated $150 was not found on any Apple page) | None | fetched |
| Small Business Program | 15 percent, but not automatic: enroll after the agreement is Active | Hoop; money left behind if skipped | fetched |
| EU trader status | Since 2025-02-17 an app with no declared status is removed in the EU. An in-app purchase is Apple's first listed indicator of being a trader. A trader's address or P.O. box, phone and email are published on the EU product page and verified. "Not a trader" keeps the app listed with a consumer-rights notice. | Hoop with a privacy cost; the alternative is to exclude the 27 EU storefronts | fetched |
| A Mac | Building needs Xcode 26 on macOS 15.6 or 26; since 2026-04-28 uploads must be built with Xcode 26. A rented runner qualifies (GitHub `macos-15`/`macos-26`, Codemagic); upload can go through the App Store Connect API with a team key | Blocker without a Mac or a macOS runner | fetched (Apple, GitHub); Codemagic snippet |
| A physical iPhone | Not stated as mandatory; Share Extensions run in the Simulator, with device-only failures reported in forums | Hoop | forum threads, fetched |
| TestFlight | Internal up to 100, external up to 10,000; the first external build goes through Beta App Review; builds expire after 90 days | Hoop | fetched |
| Age rating | New tiers 4+, 9+, 13+, 16+, 18+; questionnaire mandatory since 2026-01-31; see 2.10 for how this app should answer | Risk, see 2.10 | fetched |

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

### 4.2 Models considered, and the one chosen

**Chosen (section 10): free download, one-time supporter unlock.** The app
is free. The keyless layer, bring-your-own-key, and the community pool are
free. There is one purchase, a non-consumable in-app purchase around $4.99
(judgment call, section 9), that unlocks things that are nice and not core:
receipt themes, the hosted receipt page with a custom handle (2.7), sync
when it exists (2.2), and a supporter mark on the ledger. Nothing a person
needs to record, check and settle a bet sits behind it. It goes through
in-app purchase (Apple 3.1.1, fetched) at the 15 percent small-developer
rate on both stores, and it is the shape the benchmarks in 4.3 treat most
kindly: a paywall met after install converts at about 10.7 percent by day
35 against 2.1 percent for a free tier with a subscription above it.

**Declined, with the reason on record.**

- *Subscription for hosted checks.* Costed in 3.3, 3.6 and 4.4: about $1.28
  a month of checks against about $1.77 net from the productivity median
  annual price, break-even at best with the pre-check, and the owner's
  judgment that people will not pay several dollars a month to track bets.
  The benchmarks agree: median subscription app revenue is $492 a month and
  four in five never reach $1,000.
- *Monthly free tier of hosted checks.* At 2.1 percent conversion every
  payer brings about fifty free users; five hosted checks a month each is
  about $16 against $1.77. Loses money at every scale.
- *Paid download.* Discovery collapses (a paid listing gets a small
  fraction of a free one's installs, and the receipt page cannot bring
  anyone in if they must pay to open it), the first review is "I paid and it
  asked me for a Google API key", and paid apps carry refund and support
  expectations. No sourced figure for indie paid-app sales; the expectation
  from memory is tens to low hundreds a year.
- *Ads.* Costed from 2026 eCPM benchmark posts (snippets, gaming apps): US
  rewarded video $14 to $22 per thousand views, interstitial $9 to $14,
  banner $0.30 to $0.80. A grounded check past the pool costs about $0.063,
  so a banner needs 80 to 200 impressions per check and an interstitial
  five to seven. Only a rewarded video tied to spending a pool check comes
  close (one view covers two or three checks inside the free pool), and it
  brings an advertising identifier onto the data-safety form, an ATT prompt
  on iOS, a consent flow in the EU, a payout floor, and a video ad inside a
  product whose pitch is a receipt you can trust. Declined.
- *Bundled key.* Extracted from the APK within days.
- *Check packs.* Not needed when the user's own key is free and the pool is
  a taste. Kept as the answer if the pool ever needs to be sold rather than
  given.

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

**What this means for the price.** The unlock is a one-time non-consumable,
so the annual and monthly figures above do not apply to it directly. What
does: the hard-paywall conversion figure (a purchase offered after install,
10.7 percent by day 35) is the closer analogue to an unlock met inside a
free app, and the productivity median annual price ($24.95) says what
people in this category pay in a year, which bounds a one-time price from
above. $4.99 sits under that with room; $2.99 is the floor below which the
store fee and the friction of buying make the purchase not worth offering.
Both are guesses to be replaced by two months of data (section 7).

**What this means for the pool.** Nothing the user pays changes what the
pool costs, so the pool is sized to the free allowance and not to revenue.

**The honest read of the benchmarks.** Four apps in five never reach $1,000
a month, and this one is not built to. It is built to cost about $30 a
month at most, to be paid for by a few dozen unlocks a year, and to grow
through receipts rather than spend. Without the hosted receipt page (2.7)
the benchmarks above describe an app that a few hundred people like, which
under this plan is an acceptable outcome rather than a failed one.

### 4.4 Break-even

Arithmetic this session from 3.4, 3.6 and 4.2.

**Under the working plan.**

| Item | A year |
|---|---|
| Pool tokens at full use, $9 a month | $108 |
| Hosting, $5 a month | $60 |
| Domain | about $12 |
| Google Play account, once | $25 |
| Total before Apple | about $205 in year one, about $180 after |
| Apple developer program, when iOS ships | $99 |
| Total with Apple | about $300 in year one, about $280 after |

An unlock at $4.99 nets about $4.24 after the 15 percent fee. Break-even is
about 50 unlocks a year before Apple and about 70 with. At the 10.7 percent
hard-paywall benchmark that is roughly 470 to 660 installs a year who reach
the unlock offer; at a more cautious 5 percent, about a thousand to
fourteen hundred. Neither number is a business. Both are reachable for a
niche tool with a shareable receipt, and missing them costs about $25 a
month, which is the owner's stated comfort.

**What the declined hosted tier would have looked like**, kept so the
decision can be re-examined with new numbers rather than re-argued.

| Situation | Net price a month | Model cost, regular profile | Margin |
|---|---|---|---|
| Annual plan at the $24.95 anchor, current family past the pool, no pre-check | $1.77 | $1.28 | $0.49 |
| Annual plan, with the pre-check | $1.77 | $0.43 | $1.34 |
| Monthly plan at $3.49, no pre-check | $2.97 | $1.28 | $1.69 |
| Monthly plan at $3.49, with the pre-check | $2.97 | $0.43 | $2.54 |
| Any plan, heavy profile, no pre-check | $1.77 to $2.97 | $3.82 | negative |
| Any plan, twelve queries a check, no pre-check | $1.77 to $2.97 | $3.52 | negative |

At 2.1 percent conversion each payer arrives with about forty-seven free
users; a fifteen-check trial each is about $45 of grounded checks per payer
without the pre-check and about $14 with it, against a payer worth on the
order of $10 to $15 of margin over their life. Roughly break-even with the
pre-check, a loss without. That is why it was declined and what would have
to be true to revisit it: a conversion rate among active users well above
the download benchmark, or a per-query price cut from Google.

**What would change the working plan.** The two verification items in 2.1
(free-tier grounding, Google's terms on user keys). If either fails, the
table above is the fallback and its arithmetic applies.

---

## 5. Roadmap with gates

Each stage has an entry condition and an exit condition. Nothing in a later
stage starts before the earlier stage's exit condition is met, because every
stage's design depends on a number the previous stage produces.

### Stage 0: the two questions (before any other work)

Entry: this document adopted on `main`.

- Confirm, against Google's own pages or a live free key, that Search
  grounding works on the free tier and what the daily limit is today.
- Read the Gemini API terms for what a third-party app may do with a key
  the user supplies.

Exit: both answered and recorded in section 8. A "no" on either sends the
plan to the fallback in 4.4 before a line of store work is written.

### Stage 1: the closed test (to the first outside users)

Entry: Stage 0 exit.

Build:
- The keyless layer as a deliberate manual-first flow, replacing the regex
  drafter's apologies with a good form (2.1 part 1).
- The guided key flow (2.1 part 2), with completion counted.
- The community pool: one monthly counter capped at the free allowance,
  per-device daily and lifetime caps, kill switch, a line per call,
  reviewer allowance, BYOK bypass (2.1 part 3).
- Release signing with a stable upload key in CI; `versionCode` from CI;
  `versionName` from `package.json` (2.5).
- Privacy policy page and the consent screen before the first model call
  (2.6).
- JSON export and import through the share sheet (2.2 step 1).
- Crash reporting, opt-in, no content (2.4).
- Play Console account ($25), listing, data safety form; closed testing
  track with at least 12 testers opted in for 14 continuous days, which is
  what a personal account created after November 2023 needs before it can
  apply for production (4.1a, snippet; read the help page first).
- Fix the stale README (section 8).

Exit: the closed test has run its period; the pool has logged a month of
real checks; section 7 has values for queries per check, tokens per check,
the `no_change` share, key-flow completion, and the day of the month the
pool ran out.

Predicted outcome, so the stage is testable: at the end of it the provider
bill and the pool's own totals agree to within a few percent, the observed
queries per check is a number rather than a guess, and more than half of
the testers who start the key flow finish it. If the last one fails, the
key flow is the next piece of work, not the unlock.

### Stage 2: the unlock and the link (first hundred users)

Entry: Stage 1 exit.

Build:
- The hosted receipt page (2.7): static, public, generated on share, with
  the store link under it. The supporter unlock's custom handle rides on it.
- The supporter unlock: one non-consumable in-app purchase through
  RevenueCat's Capacitor SDK or the store directly (4.1a), gating only what
  4.2 lists.
- The pre-check (3.5), sized from the observed `no_change` share, to
  stretch the pool and keep free-tier keys under their daily limit.
- The standing fixture run and the wrong-verdict flag (2.9).

Exit: the first receipts have been opened by people who were not the
sharer; the first unlocks have been bought; the pool's exhaustion day has
moved later, not earlier, after the pre-check.

### Stage 3: durability (first thousand)

Entry: Stage 2 exit and either the median ledger size or the first jank
report crosses the threshold in section 7.

Build:
- Native SQLite driver behind `SqlDriver` (2.3).
- Accounts and sync, behind the unlock, using one of the options in 3.4
  (2.2 step 2). Email-only or no third-party login, to stay clear of
  Apple's 4.8.
- A second provider behind the `Verifier` port on the pool, so a model
  retirement or a price change is a config change, not an outage. BYOK
  users choose their own.

Exit: a user has moved phones and kept the ledger; a provider switch has
been rehearsed on the pool.

### Stage 4: reach (beyond)

Entry: Stage 3 exit and unlocks covering fixed costs for three consecutive
months.

Build:
- iOS (2.8), with the Share Extension verified first.
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
- The pool caps in the proxy match what the listing and the key flow say.
- No key, token or credential in the built APK (grep the bundle).
- Store copy, screenshots and keywords carry no gambling vocabulary (2.10);
  the age rating still answers Contests, not Simulated Gambling.
- Crash reporting reports nothing that identifies a person or quotes a
  prediction.
- Section 7 updated with the month's numbers.

### Monthly, while there are users

- Provider bill against the pool's own per-call totals. They should agree;
  if they do not, the billing unit assumption in 3.1 is wrong and this
  document is stale.
- The day of the month the pool ran out, and how many devices it served,
  into section 7. If it runs out earlier three months running, decide
  deliberately: tighten the per-device caps, ship or improve the pre-check,
  or raise the cap at $14 per 1,000 queries. Never let it drift.
- Key-flow completion rate and the share of active devices with their own
  key, into section 7.
- Unlocks this month against the break-even in 4.4.
- Median and 95th percentile ledger size, into section 7. Against the 2.3
  and 2.2 thresholds.
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
| Median ledger size, real users | | client counter, after Stage 1 | 5 MB: schedule 2.3 |
| Free-tier grounded requests a day | about 20 | observed 429 body (CLAUDE.md) | Stage 0 re-verifies; any change reshapes 2.1 |
| Pool cap | 5,000 queries a month | Vertex pricing page, fetched 2026-09-13 | raise only by decision, at $14 per 1,000 |
| Day of month the pool ran out | | pool log, monthly | earlier three months running: act (section 6) |
| Devices served by the pool a month | | pool log | |
| Key-flow completion rate | | client counter | under 50 percent: fix the flow before anything else |
| Share of active devices with their own key | | client counter | the number the plan most depends on |
| Cost per grounded check, observed | | provider bill over pool count, monthly | any drift from 3.1 |
| Tokens per check, observed | | pool log; Settings tokens line for BYOK | |
| Searches per check, observed | | grounding metadata, if it arrives | if it never arrives, billing unit is per prompt |
| `no_change` share of checks | | pool log or check table | sizes the pre-check (3.5) |
| Unlocks a month | | store console | against about 50 to 70 a year (4.4) |
| Receipts shared, and opened by someone else | | client counter; receipt page log | growth lever |
| Model version the alias resolves to | | pool log `modelVersion` | on change, re-verify 3.1 |
| Wrong verdicts | 2, both caught by the owner (HANDOFF.md) | wrong-verdict flag (2.9), fixture run | any fixture mismatch: stop and diagnose |
| Fixture run agreement | 6 of 6 on the last live pull (HANDOFF.md, 2026-09-13) | scheduled run (2.9) | any mismatch |

---

## 8. Open questions and unverified claims

Ordered by how much of the plan rests on them.

0. **Whether Search grounding works on a free Gemini key today, and at what
   daily limit.** The whole working plan rests on a free key being enough
   for a regular user. The project observed about 20 grounded requests a
   day (`CLAUDE.md`); the research found conflicting snippets on whether
   grounding is available on the free tier at all and a report that Google
   removed its free-tier table. Stage 0 exists to answer this with a live
   key or Google's own page.
0a. **Whether Google's Gemini API terms allow a third-party app to run on a
   key the user supplies.** Not checked this session. If they do not, BYOK
   is off the table and the hosted tier in 4.4 returns.
0b. **Whether a non-consumable in-app purchase for cosmetic and convenience
   features raises any review question on either store.** No rule found
   against it; Apple 3.1.1 requires IAP for it, which the plan uses.
0c. **Whether Apple still refuses "simulated gambling" apps from individual
   accounts.** A 2018 notice, applied in 2020, says so; it is absent from
   the current guidelines. This app should never be classified that way
   (2.10), so the question only matters if a reviewer disagrees.
0d. **Whether the `stakes` field stays in the store build, and under what
   label.** Owner's call (2.10).
0e. **EU availability.** Declare trader status (publishing a P.O. box, a
   phone and an email) or exclude the EU storefronts. Owner's call; either
   is allowed.

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
   way. The keyless layer and the pool mean the app never needs the key to
   function, which is the defence under both stores' minimum-functionality
   rules; the key flow should be worded as an upgrade, not a requirement.
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
- A fifteen-check trial allowance, in the declined hosted tier's
  arithmetic (4.4). Under the working plan the equivalent is the pool's
  per-device lifetime cap, left unspecified until the closed test shows how
  testers spend it.
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
- $4.99 for the supporter unlock, and the list of what it gates (4.2).
  Under the productivity median annual price, above the floor where the
  store fee and purchase friction make it pointless; two months of data
  replace it.
- The pool cap equal to Google's free allowance (5,000 queries a month).
- "More than half finish the key flow" as the Stage 1 bar.
- Manual-first as the shape of the keyless layer, rather than improving the
  regex drafter.

---

## 10. Decisions on record

Made by the owner on 2026-09-13 in the planning session that produced this
document. Recorded so the next session does not re-litigate them without
new evidence; section 8 items 0 and 0a are the evidence that would.

| Question | Decision | Reason |
|---|---|---|
| Primary model path | Bring-your-own-key | A free Gemini key covers a regular user many times over at no cost to anyone; the friction is a design problem, not an economics problem |
| Free layer | Everything that does not call a model is free forever, and made good rather than apologized for | Store minimum-functionality rules, and the product should be honest without a key |
| Hosted checks | A community pool capped at Google's free allowance, with per-device caps and a kill switch | A taste before fetching a key; cost is one dial with a known price |
| Recurring charge | None | The owner does not believe people will pay several dollars a month to track bets; the arithmetic in 4.4 agrees it would at best break even |
| Ads | No | Only a rewarded video tied to a pool check comes close to covering one, and the SDK's privacy, consent and tonal costs are not worth it (4.2) |
| Paid download | No | Kills discovery and the receipt loop; invites the "paid and it wants a Google key" review |
| The one purchase | A one-time supporter unlock around $4.99 for non-core features | One-time, keeps the app free to try, converts better than a subscription paywall by benchmark, covers fixed costs at a few dozen a year |
| Comfort with cost | Watch the pool monthly; act deliberately when it runs out early | Section 6, monthly |
