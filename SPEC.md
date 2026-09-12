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
- Deadline passes, trigger never found → `hit`, auto-resolved.
- User has set `force_manual: true` on the prediction → deadline passes, app surfaces a summary of
  everything it searched and found nothing, and asks the user to confirm. Nothing auto-resolves.

`force_manual` is a per-prediction toggle available at intake and editable at any time. Use it for
topics where the user does not trust a null search result (obscure subjects, non-English sources,
anything where "no news" plausibly means "the search was bad").

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

Criteria are freely editable until the first verification check runs. At that moment
`criteria_frozen_at` is stamped.

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
  "criteria_status": [ { "index": 0, "satisfied": true, "why": "..." } ],
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

Before the verdict is scored, the app validates every cited URL itself. This is the single most
important guardrail, because the most common model failure is a confident verdict resting on a
plausible-looking URL that does not exist.

For each source:
1. HTTP GET the URL (follow redirects, 10 second timeout).
2. If non-200 or unreachable → `fetch_status: unreachable`.
3. Strip HTML to text and search for `quoted_text` (normalized whitespace, case-insensitive,
   fuzzy match at 90% similarity to survive ellipses and smart quotes).
4. Found → `ok`. Not found → `quote_not_found`. 403 / bot wall → `blocked`.

Sources that fail validation still get stored, marked, and shown in the evidence trail. They just
do not earn points.

### 6.5 Confidence rubric

The score is computed by the app from checkable properties of the evidence. The model's own
confidence number is a minority input because it reflects how confident the sentence sounded,
not how good the evidence is.

**Evidence rubric, 100 points:**

| Dimension | Points | Scoring |
|---|---|---|
| Independent source count | 30 | 0 sources: 0. One: 10. Two independent: 22. Three or more: 30. Same publisher counts once. |
| Source tier | 25 | Highest tier present: primary/official 25, major outlet 18, secondary 10, social/blog 4. |
| URL validation | 20 | All sources `ok`: 20. Majority `ok`: 10. Any `unreachable`: 0. |
| Criteria coverage | 15 | All elements explicitly satisfied by a quoted passage: 15. Partial: 7. Inferred rather than stated: 3. |
| Temporal sanity | 10 | All sources published after `statement_date` and inside the claim window: 10. Otherwise 0. |

**Model confidence applied as a cap, not a bonus:**

```
final_score = min(evidence_rubric, model_confidence + 20)
```

A perfect evidence trail with a model that says 60% lands at 80 and goes to manual review.
A model that says 99% with one blog post still lands in the 30s.

**Hard gates. No auto-resolve if any of these are true, regardless of score:**
- Fewer than two independent sources.
- Any cited URL returned `unreachable`.
- Any source is dated before `statement_date` (unless `is_retroactive`).
- `force_manual` is set on the prediction.
- The proposed verdict is `partial` or `ambiguous`.

**Thresholds:**

| Score | Action |
|---|---|
| 95 to 100 | Auto-resolve. Notification on next open. Reversible from the detail screen. |
| 80 to 94 | Queue for approval. Feed row shows "Verdict ready", detail screen shows the proposed verdict with Approve / Reject / Edit. |
| Below 80 | No resolution. Record the check, update the trend, stay open. |

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

When a prediction resolves `miss` at its deadline, the app sets `late_watch_until` to
`resolution_date + late_watch_period` (default 3 years, configurable per prediction: never, 1 year,
3 years, forever). The prediction stays on the 30-day cadence.

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
thing is always on top:

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
- **All sources fail validation.** Downgrade the verdict to `ambiguous` with score 0, record it,
  leave the prediction open, and surface it in "Needs you" after three consecutive such checks.
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

**Receipts and case files.** The app is a ledger of people being wrong, and it should feel like
evidence, not like a productivity tool.

- **Type.** A display serif for statements and verdicts (Instrument Serif or Newsreader). A neutral
  sans for UI chrome and metadata. Statements are always set in the serif, always in quotation marks,
  always larger than they need to be. The quote is the content.
- **Surface.** Dark by default: near-black ground, warm off-white ink, a subtle paper grain on cards.
  Light mode is genuine paper cream, not white.
- **Verdicts as stamps.** HIT, MISS, PARTIAL, AMBIGUOUS, VOID render as rotated letterpress stamps
  with slightly imperfect edges. HIT green, MISS red, PARTIAL amber, AMBIGUOUS gray,
  VOID slate with a strikethrough. The "Better Late Than Never" badge is gold foil.
- **Restraint elsewhere.** Chrome, chips, and lists stay quiet so the statements carry the page.
  The costume is on the verdict and the quote, nowhere else.
- **Accessibility.** Stamps carry text labels, never color alone. Minimum 4.5:1 contrast on both themes.
  Serif display sizes stay above 18px.

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
| The model resolves confidently and wrongly | High | Hard gates, URL validation, quote matching, and the 80-94 review band exist for this |
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
| Resolution authority | Auto-resolve at 95+, manual approval 80-94, open below 80, always reversible |
| Confidence | Computed from evidence rubric; model self-confidence is a cap, not a bonus |
| Negative claims | Store a disconfirming trigger, auto-resolve hit at deadline, `force_manual` toggle to opt out |
| Late hits | Verdict stays miss permanently, gains a Better Late Than Never badge and its own list |
| Deadlines | Fixed date, window, or event-triggered; races require a stale-out date |
| Authors | First-class records, leaderboard with volume shown, minimum five scored to rank |
| Backfill | Accepted, flagged retroactive, excluded from hit-rate math |
| Categories | Closed taxonomy auto-assigned at intake, plus freeform tags |
| Notifications | Deadline day, private prompts, weekly digest. Nothing else. |
| Receipts | Shareable image, no hosted link |
| Design | Receipts and case files: serif, paper, stamped verdicts, dark by default |
| Deferred | Public figure auto-ingest, multi-user sync, adversarial verification pass |
