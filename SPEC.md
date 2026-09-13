# Mark My Words

A ledger for predictions and the people who make them.

**Version:** Spec v1.0 | **Date:** 2026-09-12 | **Target:** Android APK (sideloaded), single user

---

## 1. Problem

People make confident declarative predictions constantly, then forget them. When the prediction is
remembered at all, the timeframe has quietly slipped ("I said *eventually*"), the original wording has
softened, and nobody can produce the receipt. Existing prediction markets solve a different problem:
they need liquidity, counterparties, and formal resolution. This app solves the personal one. Capture the
claim at the moment it is made, freeze what it actually said, and let the clock and the evidence do the rest.

**Core loop:** capture a statement in one tap, let AI turn it into testable criteria, confirm, forget about it,
get pinged on deadline day with a verdict and citations.

---

## 2. Scope

### In scope for v1
- Single user, single device, no account, no server.
- Capture via Android share sheet, manual entry, and paste.
- AI-drafted resolution criteria, confirmed by the user, then frozen.
- Manual pull-to-refresh verification against live web search.
- Three deadline shapes: fixed date, date window, event-triggered (including races).
- Unverifiable / private predictions resolved by a deadline prompt.
- Six verdict states plus trend tracking on open predictions.
- Late-hit tracking ("Better Late Than Never").
- Authors as first-class records with a hit-rate leaderboard.
- Shareable receipt images.
- Local notifications: deadline day, private prompts, weekly digest.

### Explicitly deferred
- **Public figure auto-ingest.** The future-state feed that pulls politician and pundit predictions
  without user entry. Needs a news pipeline and a backend.
- **Multi-user, accounts, sync.** No auth, no cloud. Backup is a JSON export file.
- Adversarial second-pass verification (add if the model is caught being wrong).
- Per-category author statistics (schema supports it, UI does not ship).
- Play Store distribution. Sideloaded APK only.

### Hedges taken now to avoid a rewrite later
Even though sync is out of scope, every table uses UUID primary keys and carries `created_at`,
`updated_at`, and `deleted_at`. This costs nothing today and makes adding a sync backend additive
rather than a migration. Same reasoning for the verifier being behind an interface: the Gemini
implementation is the only one that ships, but swapping in a different provider is a file, not a refactor.

---

## 3. Domain model

### 3.1 Prediction

The central record. A prediction is a frozen claim, an author, a deadline, and an evidence trail.

| Concept | Meaning |
|---|---|
| `raw_statement` | Exactly what was said, verbatim. Never edited after confirmation. |
| `normalized_claim` | AI-rewritten single sentence stating the testable assertion. |
| `resolution_criteria` | An ordered list of testable elements. All must be satisfied for a Hit. |
| `polarity` | `positive` (something will happen) or `negative` (something will not happen). |
| `deadline` | One of three shapes, see 3.3. |
| `verification_mode` | `searchable` or `manual`. |
| `status` | See 3.2. |

### 3.2 Status state machine

```
                    ┌─────────┐
                    │  draft  │  captured but criteria not yet confirmed; no checks run
                    └────┬────┘
                         │ user confirms criteria
                         ▼
                    ┌─────────┐
        ┌───────────│  open   │───────────┐
        │           └────┬────┘           │
        │                │                │
   evidence         deadline passes    claim becomes
   resolves it      with no hit        moot / unfalsifiable
        │                │                │
        ▼                ▼                ▼
  ┌──────────┐      ┌────────┐       ┌────────┐
  │hit│partial│     │  miss  │       │  void  │
  │ ambiguous │     └───┬────┘       └────────┘
  └──────────┘          │
                        │ late-watch cadence continues
                        │ event eventually occurs
                        ▼
                 ┌──────────────┐
                 │ miss +       │  verdict stays MISS forever
                 │ late_hit_at  │  gains "Better Late Than Never" badge
                 └──────────────┘
```

**Six terminal-ish states:**

- `hit` - all criteria elements satisfied within the deadline.
- `miss` - deadline passed without satisfaction, or the disconfirming trigger fired.
- `partial` - some but not all criteria elements satisfied. Counts as 0.5 in hit-rate math.
- `ambiguous` - criteria cannot cleanly resolve against available evidence. Excluded from hit-rate math.
- `void` - the claim became unfalsifiable or moot (the movie was cancelled, the subject died,
  the race staled out). Excluded from hit-rate math.
- `open` - still running.

**Trend** (only meaningful while `open`): `toward_yes`, `toward_no`, `flat`, `unknown`.
Written by every check. Drives the "heat" sort on the feed and the optional sparkline.

### 3.3 Deadline shapes

**`fixed_date`** - one timestamp. "The Cardinals will win the World Series this year"
resolves at the end of the 2026 World Series, stored as a concrete date.

**`window`** - a start and end. "Next year's winter will be the biggest in a decade" becomes
window `2026-12-01` to `2027-03-20`. A hit anywhere inside the window is an on-time Hit.
Prevents judging a seasonal claim against one arbitrary day.

**`event`** - resolves when a triggering event occurs rather than on a date.
"Thor will lose his arm in Avengers: Doomsday" resolves when the film releases.
Stores `trigger_event` (natural language + search queries) and an optional
`trigger_expected_date` used only for cadence math, not for resolution.

**Race** is a subtype of `event`: two events where order decides the verdict.
"X will happen before Y" stores `event_a` and `event_b`; whichever the checks confirm first
decides Hit or Miss.

**Stale-out.** Every `event` and race prediction requires a `stale_out_date`, default five years
from the statement date. On that date, if unresolved, it auto-resolves `void` so the feed does not
accumulate zombies. User can extend it from the detail screen at any time.

### 3.4 Negative claims

"The AI bubble will NOT crash in six months" and "the neighbors will leave me alone about the gutters"
cannot be confirmed by finding evidence, only by failing to find any. Absence of evidence is
searchable only if you know what you are searching for.

At intake, every `polarity: negative` prediction must store a **disconfirming trigger**: the single
concrete event that, if found, kills the claim. Checks hunt for that trigger, never for the negative itself.

- Trigger found before deadline → `miss`, immediately.
- Deadline passes, trigger never found → the app queues a `hit` for the user's approval, with the
  check log saying what was searched. It never applies the absence on its own: "the search found
  nothing" and "nothing happened" are different claims, and only the user can make the second one.

`force_manual` is a per-prediction toggle available at intake and editable at any time. For a
negative claim it changes nothing, since the deadline path already asks.

### 3.5 Author

Every prediction attaches to exactly one author: a person, an outlet, or the user. Authors accumulate
a record. This is the feature that makes the app worth opening when nothing is due.

Fields: `display_name`, `handle`, `kind` (`person` | `outlet` | `self`), `avatar_path`, `notes`.

**Hit rate math:**
```
scored = hit + miss + partial
rate   = (hit + 0.5 * partial) / scored
```
`ambiguous`, `void`, and `open` are excluded from the denominator. Backfilled predictions
(see 10.3) are excluded entirely. Standings always display volume next to rate so a 1-for-1
does not outrank an 8-for-12; the default sort applies a minimum of five scored predictions
before an author appears in the ranked list, with everyone else in a "not enough data" section.

---

## 4. Data model (SQLite)

```sql
-- All ids are UUIDv4 text. All timestamps are ISO-8601 UTC strings.
-- created_at / updated_at / deleted_at are present everywhere for future sync.

CREATE TABLE authors (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  handle         TEXT,                    -- @liz, r/marvelstudios, etc.
  kind           TEXT NOT NULL,           -- person | outlet | self
  avatar_path    TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE predictions (
  id                    TEXT PRIMARY KEY,
  author_id             TEXT NOT NULL REFERENCES authors(id),

  -- the claim
  raw_statement         TEXT NOT NULL,    -- verbatim, immutable after confirm
  normalized_claim      TEXT NOT NULL,    -- AI rewrite, one testable sentence
  polarity              TEXT NOT NULL,    -- positive | negative
  disconfirming_trigger TEXT,             -- required when polarity = negative

  -- provenance
  statement_date        TEXT NOT NULL,    -- when it was SAID, not when captured
  source_url            TEXT,
  archive_url           TEXT,
  archive_status        TEXT,             -- pending | ok | failed | not_applicable
  screenshot_path       TEXT,
  source_context        TEXT,             -- "Instagram story", "at dinner", "CNN segment"

  -- deadline
  deadline_type         TEXT NOT NULL,    -- fixed_date | window | event
  resolution_date       TEXT,             -- fixed_date
  window_start          TEXT,             -- window
  window_end            TEXT,             -- window
  trigger_event         TEXT,             -- event
  trigger_expected_date TEXT,             -- event, cadence hint only
  race_event_b          TEXT,             -- race: the competing event
  stale_out_date        TEXT,             -- required for event/race

  -- verification config
  verification_mode     TEXT NOT NULL,    -- searchable | manual
  force_manual          INTEGER NOT NULL DEFAULT 0,
  search_queries        TEXT,             -- JSON array, AI-generated at intake
  no_check_before       TEXT,             -- skip checks until this date (saves quota)

  -- state
  status                TEXT NOT NULL,    -- draft|open|hit|miss|partial|ambiguous|void
  trend                 TEXT,             -- toward_yes|toward_no|flat|unknown
  confidence_score      INTEGER,          -- 0-100 rubric score at resolution
  resolved_at           TEXT,
  resolved_by           TEXT,             -- auto | user | user_override
  late_hit_at           TEXT,             -- set if the event occurred after a miss
  late_watch_until      TEXT,             -- when to stop post-deadline checking

  -- bookkeeping
  category              TEXT NOT NULL,    -- closed taxonomy, see 9.4
  is_retroactive        INTEGER NOT NULL DEFAULT 0,
  stakes                TEXT,             -- freeform: "$20", "a beer", "bragging rights"
  criteria_frozen_at    TEXT,             -- null until first check runs
  last_checked_at       TEXT,
  check_count           INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT
);

CREATE TABLE criteria_elements (
  id             TEXT PRIMARY KEY,
  prediction_id  TEXT NOT NULL REFERENCES predictions(id),
  position       INTEGER NOT NULL,
  text           TEXT NOT NULL,           -- one testable assertion
  satisfied      INTEGER,                 -- null = unknown, 0 = no, 1 = yes
  satisfied_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE checks (
  id               TEXT PRIMARY KEY,
  prediction_id    TEXT NOT NULL REFERENCES predictions(id),
  ran_at           TEXT NOT NULL,
  trigger          TEXT NOT NULL,         -- pull | force | deadline | backfill
  provider         TEXT NOT NULL,         -- gemini | anthropic | manual
  model            TEXT,
  proposed_verdict TEXT,                  -- hit|miss|partial|ambiguous|no_change
  proposed_trend   TEXT,
  rubric_score     INTEGER,               -- 0-100, see 6.3
  rubric_breakdown TEXT,                  -- JSON, per-dimension points
  model_confidence INTEGER,               -- what the model claimed, for comparison
  summary          TEXT NOT NULL,         -- 1-3 sentences of findings
  outcome          TEXT NOT NULL,         -- auto_resolved|queued|no_change|error
  error_message    TEXT,
  tokens_used      INTEGER,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);

CREATE TABLE evidence (
  id             TEXT PRIMARY KEY,
  check_id       TEXT NOT NULL REFERENCES checks(id),
  url            TEXT NOT NULL,
  title          TEXT,
  publisher      TEXT,
  published_at   TEXT,
  quoted_text    TEXT,                    -- the passage the model relied on
  tier           TEXT,                    -- primary|major_outlet|secondary|social
  fetch_status   TEXT NOT NULL,           -- ok|unreachable|quote_not_found|blocked
  fetched_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE amendments (
  id             TEXT PRIMARY KEY,
  prediction_id  TEXT NOT NULL REFERENCES predictions(id),
  field          TEXT NOT NULL,           -- which field changed
  old_value      TEXT NOT NULL,
  new_value      TEXT NOT NULL,
  reason         TEXT NOT NULL,           -- required, user-entered
  amended_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE
);

CREATE TABLE prediction_tags (
  prediction_id TEXT NOT NULL REFERENCES predictions(id),
  tag_id        TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (prediction_id, tag_id)
);

CREATE TABLE quota_log (
  id         TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  day        TEXT NOT NULL,               -- YYYY-MM-DD local
  calls      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (provider, day)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_pred_status_deadline ON predictions(status, resolution_date);
CREATE INDEX idx_pred_author          ON predictions(author_id);
CREATE INDEX idx_checks_pred          ON checks(prediction_id, ran_at DESC);
CREATE INDEX idx_evidence_check       ON evidence(check_id);
```

---

## 5. Intake pipeline

### 5.1 Capture surfaces

1. **Android share sheet** (primary). Intent filters for `ACTION_SEND` with `text/plain` and `image/*`.
   Sharing an Instagram or Reddit post hands the app a URL and sometimes a text blob.
2. **Manual entry.** Big "+" on the feed. For things said out loud.
3. **Paste.** Clipboard detection when the app opens with a URL on the clipboard, offered as a dismissible bar.

Capture is one tap. Nothing blocks. The prediction lands as `status: draft`.

### 5.2 Archiving the source

Fires immediately and asynchronously on capture, before the AI call:

1. POST the URL to the Wayback Machine save endpoint. Store the resulting snapshot URL.
2. In parallel, attempt archive.today.
3. Record `archive_status`. On failure, push to a retry queue that re-attempts on the next app open,
   up to three times over 48 hours.
4. If both fail, prompt the user to attach a screenshot instead.

**Known weakness:** Instagram and TikTok routinely defeat both archive services. For these domains,
skip straight to prompting for a screenshot. Detect by hostname.

### 5.3 AI structuring call

Single call to the configured provider. Input: raw text, source URL, page content if fetchable,
today's date. Output must validate against this schema or the call is retried once with a repair prompt.

```jsonc
{
  "normalized_claim": "string, one sentence, testable",
  "polarity": "positive | negative",
  "disconfirming_trigger": "string | null",   // required if polarity is negative
  "criteria_elements": [
    "string"                                   // 1-5 items, each independently checkable
  ],
  "deadline_type": "fixed_date | window | event",
  "resolution_date": "ISO date | null",
  "window_start": "ISO date | null",
  "window_end": "ISO date | null",
  "trigger_event": "string | null",
  "trigger_expected_date": "ISO date | null",
  "race_event_b": "string | null",
  "deadline_reasoning": "string, why this date/window/event",
  "verifiability": "searchable | manual",
  "verifiability_reasoning": "string",
  "search_queries": ["string"],               // 2-5 queries the verifier should run
  "no_check_before": "ISO date | null",       // earliest date this could plausibly resolve
  "category": "Sports | Tech/AI | Politics | Economics | Weather/Climate | Entertainment | Personal | Other",
  "tags": ["string"],
  "author_guess": "string | null",
  "statement_date_guess": "ISO date | null",
  "ambiguities": ["string"]                   // things the user must disambiguate
}
```

**Prompt requirements:**
- Resolution criteria must be things a search could confirm or refute, not adjectives.
  "The AI bubble will crash" becomes something like: (1) a named AI-heavy index or basket falls 30%
  or more from its peak, (2) within the stated period, (3) as reported by at least two financial outlets.
- The model must state its reasoning for the deadline. The user is going to read it and override
  roughly a third of the time.
- The model must flag ambiguities rather than guessing. "The Cardinals" is Arizona or St. Louis.
  "Next winter" is hemisphere-dependent.

### 5.4 Review card

The user sees a single scrollable card:

- The raw statement, quoted, with the archive status badge.
- Author field, prefilled from `author_guess`, with autocomplete against existing authors.
- Statement date, defaulting to today or `statement_date_guess`.
- The normalized claim, editable.
- The criteria elements as a list, each editable, add and remove allowed.
- The deadline, with its reasoning shown underneath and a picker to override.
- Verifiability toggle (`searchable` / `manual`) and the `force_manual` switch.
- Category chip and tags.
- Optional stakes field.
- Any `ambiguities` surfaced as inline questions that must be answered before confirming.

Confirm sets `status: open` and starts the clock. Drafts persist indefinitely and show in a
"Needs review" chip on the feed. No checks run on drafts.

### 5.5 Criteria freezing and amendments

Criteria are freely editable while the prediction is a draft. Confirming it stamps
`criteria_frozen_at`. (The first check stamps it too, as a backstop for rows that opened another
way.) It used to freeze on the first check; that left a claim due months out quietly editable for
the whole wait.

After freezing, edits still work but write an `amendments` row capturing the old value, new value,
timestamp, and a **required** user-entered reason. Any prediction with one or more amendments displays
an "amended" marker on the detail screen, in the feed row, and on its shareable receipt. The receipt
lists the amendments. This is the anti-goalpost-moving mechanism: editing is allowed, hiding is not.

---

## 6. Verification engine

### 6.1 Trigger

Verification runs only on user pull-to-refresh on the feed. There is no cron, no background job,
no server. A long-press on a single prediction force-checks that one item, bypassing the cadence gate.

### 6.2 Cadence gate

A pull does not check everything. It checks only what is due.

| Condition | Check interval |
|---|---|
| More than 180 days to deadline | every 30 days |
| 31 to 180 days | every 14 days |
| 8 to 30 days | every 7 days |
| 0 to 7 days | every pull, minimum 12 hours apart |
| Deadline passed, inside late-watch | every 30 days |
| `no_check_before` in the future | never |
| `verification_mode: manual` | never |
| `status: draft` | never |
| Event/race with no expected date | every 30 days until stale-out |

**Per-pull budget.** Default 10 checks per pull, configurable. If more items are due than the budget
allows, they are ordered by priority and the remainder deferred with a visible "3 more deferred" note.

Priority order: (1) past deadline and unresolved, (2) inside 7 days, (3) longest time since last check,
(4) never checked.

**Quota guard.** Before each call, check `quota_log` for today. If the pull would exceed the configured
daily cap, stop and report how many ran and how many were deferred. Never fail silently.

### 6.3 The check call

Input assembled per prediction:

```jsonc
{
  "claim": "<normalized_claim>",
  "polarity": "positive | negative",
  "disconfirming_trigger": "<string or null>",
  "criteria_elements": ["..."],
  "statement_date": "<ISO>",
  "deadline": { "type": "...", "..." : "..." },
  "suggested_queries": ["..."],
  "today": "<ISO>",
  "prior_findings": "<summary of the last 2 checks, or null>"
}
```

The model is instructed to use web search grounding and return:

```jsonc
{
  "verdict": "hit | miss | partial | ambiguous | no_change",
  "trend": "toward_yes | toward_no | flat | unknown",
  "summary": "1-3 sentences",
  "criteria_status": [ { "index": 1, "satisfied": true, "why": "..." } ],   // 1-based, as listed in the prompt
  "sources": [
    {
      "url": "https://...",
      "title": "...",
      "publisher": "...",
      "published_at": "ISO date",
      "quoted_text": "the exact passage relied on",
      "tier": "primary | major_outlet | secondary | social"
    }
  ],
  "model_confidence": 0
}
```

### 6.4 Source validation

The app opens every cited URL itself, to confirm the link goes somewhere. This is the guardrail
against the one failure nothing else in the pipeline can catch: a confident verdict resting on a
plausible-looking URL that does not exist.

For each source:
1. HTTP GET the URL, following redirects. Grounding returns redirect addresses, and the source is
   recorded against where the fetch landed, since tier and independence are judged from the domain.
2. 404 / 410 / DNS failure → `unreachable`. 403 / paywall / timeout → `blocked`. Anything that
   answered → `ok`. Seeded or imported evidence is `not_checked`.

The page body is not read. An earlier version matched it against the quoted passage, then against
the passage's figures; neither answer reached a decision, and a text match cannot tell a rewritten
page from an invented one. The quoted passage is still requested and shown beside the link as the
citation. On screen a working link gets a green check and a dead one a yellow mark, and that is all
the mark means.

### 6.5 What stands between a verdict and the record

The verdict is the model's. The app applies it unless it noticed something about the citations
that a person should see first, or the model itself reported it was unsure. There is no score.

**Gates. A gated verdict is queued for approval, never buried and never applied:**
- The proposed verdict is `partial` or `ambiguous`.
- `force_manual` is set on the prediction.
- No sources were cited, or only one and it is not a primary source (a .gov host or a governing
  body the app recognises). One source is enough when it is the body that keeps the record.
- Every cited link is unreachable. One dead link among pages that resolved is a citation error,
  not fabrication; it just stops counting as corroboration.
- Every source predates the prediction (unless `is_retroactive`). One old background page among
  newer ones is fine.
- A source is credited to a publisher the host cannot be, and nothing clean and reachable is left.
  If other sources stand, the mismatch is noted on the row instead.

**Model confidence:** read once. Under 70 the verdict is queued, because that is the model saying it
is torn. It never raises anything.

A gate fires on "nothing here works", never on "one thing does not". Every gate that fired on a
single bad citation among good ones blocked a correct verdict, four times over.

### 6.6 Reversal and override

Any auto-resolved verdict can be reversed from the detail screen. Reversal writes a `checks` row with
`provider: manual` and `trigger: force`, sets `resolved_by: user_override`, and the record shows an
"overridden" marker. The user can also resolve any prediction manually at any time, including against
the evidence. Logged the same way. The app never prevents the user from being the final authority;
it only makes the trail visible.

---

## 7. Resolution rules

### 7.1 On-time resolution
- **Positive, fixed date:** all criteria elements satisfied on or before `resolution_date` → `hit`.
  Deadline passes unsatisfied → `miss`.
- **Positive, window:** satisfied anywhere between `window_start` and `window_end` → `hit`.
- **Positive, event:** satisfied when `trigger_event` is confirmed to have occurred, evaluated against
  the criteria at that point.
- **Race:** whichever of `trigger_event` / `race_event_b` is confirmed first decides. Both confirmed
  in the same check → the model must state ordering with a dated source, or the verdict is `ambiguous`.
- **Negative:** see 3.4.
- **Partial:** some criteria elements satisfied, some not, at deadline. Counts 0.5 in hit rate.

### 7.2 Late hits ("Better Late Than Never")

The verdict never changes. A miss is a miss permanently, because the timeframe was part of the claim.

Every prediction carries `can_happen_late`: whether the claim could still come true after its
deadline. The intake model sets it (event-shaped claims almost always, dated ones rarely: "Bitcoin
by the end of 2024" yes, "85F on September 12" no) and the review card shows it as a checkbox on
dated claims. When a prediction that can happen late resolves `miss`, the app sets
`late_watch_until` to `resolution_date + late_watch_period` (default 3 years) and the prediction
stays on the 30-day cadence. One that cannot gets no watch and no "it happened anyway" control:
every check under watch is a paid call, and a day's high temperature cannot change.

A late-watch check that confirms the miss records the check and changes nothing. It must never try
to re-apply the verdict; that once threw on the miss-to-miss transition and ended the whole pull.

If the event later occurs, the app sets `late_hit_at`, keeps `status: miss`, and the record gains a
gold "Better Late Than Never" badge showing the actual delay: *"Called it, 19 months late."*
A dedicated feed chip lists these. Late hits do not change hit rate. They are their own kind of credit.

### 7.3 Voiding

A prediction resolves `void` when:
- The stale-out date is reached on an unresolved event or race.
- The subject becomes moot (the film was cancelled, the company dissolved, the person died) and a
  check reports the claim can no longer be evaluated.
- The user voids it manually with a reason.

Void predictions are excluded from all hit-rate math and live behind a filter chip.

---

## 8. Notifications

Local only, scheduled on-device via Capacitor local notifications. No push service, no server.
Three triggers, nothing else.

1. **Deadline day.** Fires on the morning of a prediction's deadline (or window end, or expected
   event date). "Popops said the Cardinals would win the World Series. Today's the day."
   Tapping opens the detail screen.

2. **Private prediction prompt.** For `verification_mode: manual` predictions, fires on the deadline
   with inline action buttons: **Yes** / **No** / **Not yet**. Yes and No resolve the prediction from
   the notification with zero taps into the app. "Not yet" snoozes seven days and re-fires. After
   four snoozes it prompts to extend the deadline or void.

3. **Weekly digest.** Sunday morning. What resolved this week, what is coming in the next 30 days,
   how many verdicts are waiting for approval, anything that flipped trend. One notification,
   opens to the feed.

Verification results are never pushed. Checks only run when the user pulls, so there is nothing
to announce that the user was not already looking at.

**Android caveat:** Doze mode and OEM battery managers will delay exact alarms. Schedule with
inexact alarms and a wide window; deadline-day precision to the hour is not needed. Re-schedule all
pending notifications on every app open to recover from any that the OS dropped.

---

## 9. UI / UX

### 9.1 Feed (home)

One scrolling list. No tabs. Pull-to-refresh at the top triggers verification.

**Heat sort.** Default ordering is by a computed heat score, not by date, so the most interesting
thing is always on top. Two things sit beside the rule without replacing it: a row can be **pinned**
from its press-and-hold menu (pinned rows hold the top, in the order pinned, and the rest of the feed
keeps its order beneath them), and the header's funnel opens an **order and filter** sheet with the
other orders a long ledger wants (deadline soonest, newest, oldest, by author) as a per-device
preference. Drag-to-reorder was asked for and declined: a hand-sorted ledger lets a bad call be
buried under a good one, which is what the heat sort exists to prevent.

```
heat = 0
  + 100 if past deadline and unresolved
  + 90  if a verdict is queued for approval
  + 80  if a draft needs review
  + max(0, 60 - days_until_deadline)
  + 30  if the last check changed the trend
  + 20  if new evidence since the user last viewed it
  + 10  if never checked
```

**Filter chips** across the top, horizontally scrollable:
`All` · `Open` · `Needs you` · `Resolved` · `Late hits` · `Void` · `By author` · category chips.

**Row anatomy:**
- Author name and avatar, small.
- The raw statement, truncated to three lines, in the display serif.
- A status line: countdown ("41 days"), or the verdict stamp, or "Verdict ready".
- Trend arrow for open predictions.
- Amended marker if applicable.

**Empty state** matters here. On first run the feed shows three example predictions drawn from the
user's own examples (the Cardinals, the AI bubble, the gutters) as tappable demos that can be deleted.

### 9.2 Detail screen

Top to bottom, single scroll, no tabs:

1. **The quote.** Large, serif, in quotation marks. Author, handle, statement date underneath.
   Source link and archive link as small chips. Screenshot thumbnail if attached.
2. **Verdict or countdown.** If resolved, the stamp, rotated, with the resolution date and
   `resolved_by`. If open, the countdown and trend.
3. **Resolution criteria.** The frozen list, each element with a check/cross/question icon showing
   current satisfaction. Amendments marker expands to show the full amendment history.
4. **Actions.** Force check. Resolve manually. Amend criteria. Extend deadline. Void. Share receipt.
5. **Check log.** Reverse chronological. Every check ever run as a timeline entry:
   date, summary, proposed verdict, rubric score with a tap-to-expand breakdown, and the source list
   with per-source validation status (green check, amber "quote not found", red "unreachable").
   The check log is the receipt. It is not collapsed by default.

### 9.3 Author page and standings

**Author page:** name, avatar, record line ("8-4-1, 66%"), a list of their predictions grouped by
status, and their best and worst calls.

**Standings screen:** ranked table of authors with at least five scored predictions.
Columns: rank, name, record, hit rate. Below the fold, a "not enough data" section for everyone else.
Sort toggles between rate, volume, and most recent activity.

### 9.4 Categories

Closed taxonomy, assigned by the intake AI, editable by the user:
`Sports` · `Tech/AI` · `Politics` · `Economics` · `Weather/Climate` · `Entertainment` · `Personal` · `Other`

Freeform tags sit alongside for everything the taxonomy misses. The closed list keeps filters and
future per-category statistics usable; freeform tags alone would degrade into `AI` / `ai` /
`artificial intelligence` within a month.

### 9.5 Settings

- API provider and key (paste field, masked, stored in secure storage).
- Daily quota cap and per-pull budget.
- Quota meter: "14 of 250 checks used today."
- Default late-watch period.
- Notification toggles for the three triggers, plus digest day and time.
- Export data (JSON file, share sheet).
- Import data (file picker, with a merge-or-replace choice).
- Demo data reset.

---

## 10. Edge cases

### 10.1 Verification failures
- **Malformed model JSON.** Retry once with a repair prompt containing the schema and the bad output.
  On second failure, write a `checks` row with `outcome: error` and move on. Never consume the
  prediction's cadence slot on an error; it stays due.
- **No cited link resolves.** The verdict is queued for the user with the reason on the check log.
  It is the signature of invented citations, and also of a model that got every deep link wrong.
- **Offline pull.** Detect no connectivity, show "Offline. Last checked 4 days ago" without consuming
  quota or writing check rows.
- **Quota exhausted mid-pull.** Stop cleanly, report checks completed and deferred, keep the deferred
  items due for the next pull.
- **Search is structurally weak on the topic.** Sports scores, local weather, and niche sports
  statistics resolve poorly through general web search. The intake AI should flag these and lean
  toward suggesting `force_manual`. This is a known limitation, not a bug to chase in v1.

### 10.2 Claim ambiguity
- **Ambiguous entity.** "The Cardinals" (Arizona or St. Louis), "the election" (which one).
  Surfaced in `ambiguities` at intake and must be resolved before confirming.
- **Hemisphere-dependent seasons.** "Next winter" defaults to the user's hemisphere; the intake AI
  states its assumption in `deadline_reasoning`.
- **Timezone and "by Halloween."** All timestamps stored UTC. Date-only deadlines resolve at
  23:59:59 local time on that date. Display always local.
- **Deadline already in the past at intake.** Warn, and offer either to fix the date or to mark the
  entry retroactive.

### 10.3 Retroactive entries

Predictions entered after the fact are accepted. `is_retroactive: true`, and the app verifies
immediately rather than waiting for a cadence slot.

Retroactive predictions are **excluded from author hit-rate math** and marked "entered after the fact"
everywhere they appear, including receipts. The reason is selection bias: people backfill the
memorably wrong calls and the memorably right ones, never the boring middle, so including them would
make every leaderboard number meaningless. They still show on the author's page as records.

### 10.4 Duplicates and relationships
- **Duplicate detection.** On confirm, fuzzy-match the normalized claim against open predictions.
  If similarity is high, offer "This looks like an existing prediction" with a link, and let the user
  either attach it as a second author making the same call, or proceed anyway.
- **Same claim, multiple authors.** Supported as separate prediction rows linked by a shared
  `normalized_claim`. Each author gets independently scored.
- **Opposing predictions.** Two predictions where one's hit implies the other's miss. Not modeled
  explicitly in v1; both simply resolve on their own evidence. Noted as a post-v1 improvement.

### 10.5 Source integrity
- **Deleted source post.** The archive URL is the fallback. If archiving also failed and no screenshot
  exists, the prediction shows an "unverified source" marker. It still tracks; it is just weaker as a receipt.
- **Instagram / TikTok.** Both routinely defeat archive services. Skip archiving for these hosts and
  prompt for a screenshot at capture.
- **Paywalled evidence.** Fetch returns `blocked`. Counts as not validated and does not earn points.

### 10.6 Data
- **Export** is a single JSON file containing all tables plus base64 screenshots, shared via the
  Android share sheet (Drive, email, wherever).
- **Import** offers merge (by UUID, newest `updated_at` wins) or replace.
- **Deletion** is soft (`deleted_at`) so a future sync has tombstones. A hard-purge action lives in settings.

---

## 11. Technical implementation

### 11.1 Stack

| Layer | Choice | Reason |
|---|---|---|
| UI | React 18 + TypeScript + Vite | Runs in a browser during development, which makes AI-assisted iteration fast |
| Shell | Capacitor 6 | Real APK, native plugins, and the same build runs as a PWA |
| Database | `@capacitor-community/sqlite` | Local SQLite with a web fallback (sql.js) for browser development |
| State | TanStack Query over a repository layer | Cache invalidation on pull maps cleanly to the refresh model |
| Styling | Tailwind + CSS variables for theming | Fast, and the design system in 12 is mostly typography and color tokens |
| Notifications | `@capacitor/local-notifications` | On-device scheduling, no push service |
| Secure storage | `capacitor-secure-storage-plugin` | Android Keystore-backed key storage |
| Share target | Android intent filter + `send-intent` plugin | Receives shared text and images |
| Receipt images | Offscreen DOM rendered via `html-to-image`, saved with `@capacitor/filesystem`, shared via `@capacitor/share` | No server render needed |

### 11.2 Project structure

```
src/
  domain/           # pure types and rules, zero I/O
    prediction.ts   # types, state machine, status transitions
    cadence.ts      # due-for-check logic
    rubric.ts       # confidence scoring, hard gates
    scoring.ts      # hit-rate math
  data/
    db.ts           # connection, migrations
    repositories/   # predictions, authors, checks, evidence, amendments
    export.ts
  verification/
    Verifier.ts     # interface: structure(), check()
    GeminiVerifier.ts
    AnthropicVerifier.ts   # stub in v1, same interface
    validateSources.ts     # URL fetch + quote matching
    prompts/
  capture/
    shareTarget.ts
    archive.ts      # wayback + archive.today + retry queue
  notifications/
    schedule.ts
    digest.ts
  ui/
    screens/        # Feed, Detail, IntakeReview, Author, Standings, Settings
    components/     # Stamp, PredictionRow, CheckLogEntry, EvidenceItem, ReceiptCard
    theme/
```

The `domain/` layer is pure functions over plain objects, which means the cadence gate, the rubric,
and the state machine are unit-testable without a database or a network. Those three are where the
bugs will live, so they get real test coverage.

### 11.3 Provider abstraction

```ts
interface Verifier {
  structure(input: StructureInput): Promise<StructuredPrediction>;
  check(input: CheckInput): Promise<CheckResult>;
  readonly providerId: string;
  readonly dailyQuota: number | null;
}
```

`GeminiVerifier` ships in v1, using Gemini Flash with Google Search grounding on the free tier.
`AnthropicVerifier` is scaffolded against the same interface so a paid key can be dropped in for
hard cases later without touching the calling code. Provider selection lives in settings.

**Verify at build time:** the exact free-tier request and grounding limits for the current Gemini
Flash model. These change, and the quota cap default should be set from the real number, not from
this document.

### 11.4 Security
- The API key is written only to Android Keystore-backed secure storage, never to
  `localStorage`, `Preferences`, or the SQLite file.
- The key never appears in logs, exports, or error messages.
- The export file contains prediction data only, no credentials.
- **If this ever ships to Play Store,** a bundled key is not viable. Either require each user to paste
  their own key (acceptable for a niche tool) or add a thin backend proxy holding the key with
  per-account rate limiting. Design decision deferred, but the verifier interface makes it a
  transport swap rather than a rewrite.

---

## 12. Design direction

**Spotlight.** A ledger of people being wrong should feel like a record under a
light, not like a productivity tool and not like a costume. The claim and the
verdict carry the page; everything else gets out of the way.

The values live in `design/tokens.css`, with the reasoning for each one beside
it, and take effect in `src/styles.css`. The screens are drawn on two published
canvases: `design/screens` is the current design, `design/motifs` is the record
of how it was chosen and deliberately still contains the options that lost.

- **Type.** Four families, one job each, all self-hosted in `public/fonts`.
  Cormorant for the human's own words and only ever those; Oswald for headlines,
  verdict words and section labels; Barlow Condensed for chrome; IBM Plex Mono
  for metadata, timestamps and hosts. Statements are always in the serif, always
  in quotation marks, always larger than they need to be.
- **Surface.** Dark by default: near-black ground, warm off-white ink, and a
  wide ambient glow whose origin sits near or past an edge so only the falloff
  is ever on screen. An origin inside the frame makes it a stage light. The glow
  is kept low, because every unit of it is contrast taken off the ink above it.
  Light mode is paper cream, not white.
- **One accent, fixed.** Slate, `#8792ab`, and the near-neutrality is the point.
  Green, red and gold belong to the verdicts and amber is the attention signal,
  so an accent with real chroma competes with the only colours that mean
  anything. It carries fills, active states and selection, never reading text.
  There is no accent picker: six palettes meant designing for the worst of them.
- **Amber means the app is asking you for something.** Waiting on you, the
  verdict-ready flag, a dead link, the Sample badge, a source credited to the
  wrong outlet. Never decorative. It is the only saturated thing on a screen
  that has one, which is what makes it work.
- **Verdicts, not stamps.** Flat and filled on the share cards, outlined in the
  app. Never rotated: a tilted outline reads as a novelty sticker at the size
  these actually get seen. Proven green, Busted red, Split amber, Unclear grey,
  Moot slate. The late badge is gold. The words shown to a person live in
  `STATUS_LABEL` (`src/domain/format.ts`); the stored values stay `hit` / `miss`
  / `partial` / `ambiguous` / `void`, because those are also the model's JSON
  contract and the schema's column values.
- **The model's output is glass.** The verdict panel is the one translucent
  surface in the system: frosted over the glow on dark, a raised warm card on
  light. Everything else is opaque.
- **Prose is translucent, small type is not.** Running sentences are warm white
  at reduced alpha so the glow tints them and they belong to the ground.
  Anything small or uppercase stays solid: transparency costs contrast and small
  type has none to spare.
- **Restraint elsewhere.** Chrome, chips and lists stay quiet. Air where there
  is one thing, density where there is a list.
- **Accessibility.** Verdicts carry text labels, never colour alone. Minimum
  4.5:1 contrast on both themes. Serif display sizes stay above 18px. Any
  design resting on telling red from green is checked against a deuteranopia
  simulation and a grayscale pass before it ships; the icon's ramp survives both
  because nothing in it depends on that distinction.

### The mark

A round speech bubble whose circle doubles as a clock dial: what was said, and
the deadline running on it. The bubble carries a green-gold-red ramp, the hour
hand is cream, and the minute hand is the fail red.

Three compositions, and they are not the same drawing at three sizes. The
square store icon lets the tail run almost into the corner. The adaptive
foreground is inset to clear the 66dp safe circle, because a launcher mask is
chosen by the manufacturer and may be a circle that would amputate the tail. The
legacy round icon sits between them. `design/icon/export/README.md` has the
numbers and why each one is what it is.

### Receipt card

One tap from any resolved prediction. Renders an offscreen card at 1080x1350, saves to gallery,
and opens the share sheet.

Contents: the quote in large serif, author and handle, the date it was said, the deadline, the verdict
stamp, the resolution date, up to three source citations, the amended marker if applicable, the
retroactive marker if applicable, and a small app wordmark. Everything needed to settle an argument
with someone who does not have the app.

A second variant renders an author scorecard ("Popops: 3 for 11 since 2024") which is, realistically,
the one that actually gets shared.

---

## 13. Build order

| Phase | Deliverable |
|---|---|
| 0.1 | SQLite schema, migrations, repositories. Manual entry, feed, detail, manual resolve. No AI. Runs in browser. |
| 0.2 | Intake AI: structuring call, review card, criteria elements, freezing, amendments. |
| 0.3 | Verification engine: cadence gate, check call, source validation, rubric, thresholds, pull-to-refresh, quota meter. |
| 0.4 | Notifications: deadline day, private prompts with inline actions, weekly digest. |
| 0.5 | Authors, standings, receipt image generation. |
| 0.6 | Capacitor wrap, Android share target, archiving, secure storage, export/import. |
| 1.0 | Design pass, empty states, APK build, sideload. |

Post-v1, in likely order: adversarial second-pass verification, per-category author statistics,
sync backend, public figure auto-ingest.

---

## 14. Risks

| Risk | Severity | Response |
|---|---|---|
| Gemini free-tier grounding limits are lower than assumed | Medium | Quota meter and per-pull budget already cap usage; fall back to a paid key |
| Archive services fail on the platforms that matter most (Instagram, TikTok) | Medium | Screenshot prompt at capture for those hosts |
| Source URL fetching is blocked by bot walls on major outlets | Medium | `blocked` status earns no points; rubric already tolerates partial validation |
| The model resolves confidently and wrongly | High | The gates, the link check, the model's own confidence, and a reversible verdict exist for this |
| Capture friction kills the habit | High | Share sheet must work on day one; a capture that takes more than one tap will not happen |
| App is opened rarely enough that checks never run | Medium | The three notification triggers are the only thing pulling the user back; measure and add if needed |
| Android OEM battery managers drop scheduled notifications | Medium | Re-schedule all pending notifications on every app open |

---

## 15. Decisions on record

| Question | Decision |
|---|---|
| Platform | Android APK via Capacitor, sideloaded, Play Store optional later |
| AI provider | Gemini free tier primary, Anthropic swappable via the same interface |
| Check trigger | Manual pull-to-refresh only, no cron, no server |
| Check selection | Cadence scaled to time remaining, per-pull budget, priority ordered |
| Storage | On-device SQLite, JSON export for backup, UUID + timestamp fields for future sync |
| Capture | Android share sheet, auto-archive source URLs |
| Intake | AI drafts resolution criteria, user confirms, criteria freeze on first check |
| Criteria edits | Free until first check, then amendment log with required reason |
| Verdict states | open (with trend), hit, miss, partial, ambiguous, void |
| Resolution authority | The verdict is applied unless a gate fires or the model reports confidence under 70; then it is queued for approval; always reversible |
| Confidence | No score. The model's confidence is read once, as a reason to ask |
| Negative claims | Store a disconfirming trigger; at the deadline with nothing found, queue a hit for approval |
| Late hits | Verdict stays miss permanently, gains a Better Late Than Never badge and its own list; watched by default only for event-shaped claims |
| Deadlines | Fixed date, window, or event-triggered; races require a stale-out date |
| Authors | First-class records, leaderboard with volume shown, minimum five scored to rank |
| Backfill | Accepted, flagged retroactive, excluded from hit-rate math |
| Categories | Closed taxonomy auto-assigned at intake, plus freeform tags |
| Notifications | Deadline day, private prompts, weekly digest. Nothing else. |
| Receipts | Shareable image, no hosted link |
| Design | Receipts and case files: serif, paper, stamped verdicts, dark by default |
| Deferred | Public figure auto-ingest, multi-user sync, adversarial verification pass |
