import type { SqlDriver } from './driver';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Migrations are append-only. Never edit a shipped one; add the next version.
 * Schema mirrors SPEC.md section 4.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE authors (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  handle         TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('person','outlet','self')),
  avatar_path    TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE predictions (
  id                    TEXT PRIMARY KEY,
  author_id             TEXT NOT NULL REFERENCES authors(id),

  raw_statement         TEXT NOT NULL,
  normalized_claim      TEXT NOT NULL,
  polarity              TEXT NOT NULL CHECK (polarity IN ('positive','negative')),
  disconfirming_trigger TEXT,

  statement_date        TEXT NOT NULL,
  source_url            TEXT,
  archive_url           TEXT,
  archive_status        TEXT NOT NULL DEFAULT 'not_applicable'
                          CHECK (archive_status IN ('pending','ok','failed','not_applicable')),
  screenshot_path       TEXT,
  source_context        TEXT,

  deadline_type         TEXT NOT NULL CHECK (deadline_type IN ('fixed_date','window','event')),
  resolution_date       TEXT,
  window_start          TEXT,
  window_end            TEXT,
  trigger_event         TEXT,
  trigger_expected_date TEXT,
  race_event_b          TEXT,
  stale_out_date        TEXT,

  verification_mode     TEXT NOT NULL CHECK (verification_mode IN ('searchable','manual')),
  force_manual          INTEGER NOT NULL DEFAULT 0,
  search_queries        TEXT NOT NULL DEFAULT '[]',
  no_check_before       TEXT,

  status                TEXT NOT NULL
                          CHECK (status IN ('draft','open','hit','miss','partial','ambiguous','void')),
  trend                 TEXT CHECK (trend IN ('toward_yes','toward_no','flat','unknown')),
  confidence_score      INTEGER,
  resolved_at           TEXT,
  resolved_by           TEXT CHECK (resolved_by IN ('auto','user','user_override')),
  late_hit_at           TEXT,
  late_watch_until      TEXT,

  category              TEXT NOT NULL,
  is_retroactive        INTEGER NOT NULL DEFAULT 0,
  stakes                TEXT,
  criteria_frozen_at    TEXT,
  last_checked_at       TEXT,
  check_count           INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,

  -- A negative claim is only checkable if we know what would disprove it.
  CHECK (polarity = 'positive' OR disconfirming_trigger IS NOT NULL),
  -- An event or race needs a rope end or it hangs in the feed forever.
  CHECK (deadline_type <> 'event' OR stale_out_date IS NOT NULL)
);

CREATE TABLE criteria_elements (
  id             TEXT PRIMARY KEY,
  prediction_id  TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  text           TEXT NOT NULL,
  satisfied      INTEGER,
  satisfied_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE checks (
  id               TEXT PRIMARY KEY,
  prediction_id    TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  ran_at           TEXT NOT NULL,
  trigger          TEXT NOT NULL CHECK (trigger IN ('pull','force','deadline','backfill')),
  provider         TEXT NOT NULL,
  model            TEXT,
  proposed_verdict TEXT,
  proposed_trend   TEXT,
  rubric_score     INTEGER,
  rubric_breakdown TEXT,
  model_confidence INTEGER,
  summary          TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('auto_resolved','queued','no_change','error')),
  error_message    TEXT,
  tokens_used      INTEGER,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);

CREATE TABLE evidence (
  id             TEXT PRIMARY KEY,
  check_id       TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  title          TEXT,
  publisher      TEXT,
  published_at   TEXT,
  quoted_text    TEXT,
  tier           TEXT CHECK (tier IN ('primary','major_outlet','secondary','social')),
  fetch_status   TEXT NOT NULL CHECK (fetch_status IN ('ok','unreachable','quote_not_found','blocked')),
  fetched_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE TABLE amendments (
  id             TEXT PRIMARY KEY,
  prediction_id  TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  field          TEXT NOT NULL,
  old_value      TEXT NOT NULL,
  new_value      TEXT NOT NULL,
  reason         TEXT NOT NULL,
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
  prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prediction_id, tag_id)
);

CREATE TABLE quota_log (
  id       TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  day      TEXT NOT NULL,
  calls    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (provider, day)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_pred_status_deadline ON predictions(status, resolution_date);
CREATE INDEX idx_pred_author          ON predictions(author_id);
CREATE INDEX idx_criteria_pred        ON criteria_elements(prediction_id, position);
CREATE INDEX idx_checks_pred          ON checks(prediction_id, ran_at DESC);
CREATE INDEX idx_evidence_check       ON evidence(check_id);
CREATE INDEX idx_amend_pred           ON amendments(prediction_id, amended_at DESC);
`,
  },
  {
    version: 2,
    name: 'intake notes',
    sql: `
ALTER TABLE predictions ADD COLUMN intake_notes TEXT;
`,
  },
  {
    version: 3,
    name: 'manual prompt snoozes',
    sql: `
ALTER TABLE predictions ADD COLUMN prompt_snoozes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE predictions ADD COLUMN prompt_next_at TEXT;
`,
  },
  {
    version: 4,
    name: 'archive attempts',
    sql: `
ALTER TABLE predictions ADD COLUMN archive_attempts INTEGER NOT NULL DEFAULT 0;
`,
  },
  /*
   * SQLite cannot widen a CHECK constraint in place, so the table is rebuilt.
   * Rows carry over untouched: `facts_found` is a new outcome the matcher can
   * now reach, not a reinterpretation of anything already recorded.
   */
  {
    version: 5,
    name: 'facts_found fetch status',
    sql: `
CREATE TABLE evidence_new (
  id             TEXT PRIMARY KEY,
  check_id       TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  title          TEXT,
  publisher      TEXT,
  published_at   TEXT,
  quoted_text    TEXT,
  tier           TEXT CHECK (tier IN ('primary','major_outlet','secondary','social')),
  fetch_status   TEXT NOT NULL
                   CHECK (fetch_status IN ('ok','facts_found','unreachable','quote_not_found','blocked')),
  fetched_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
INSERT INTO evidence_new SELECT * FROM evidence;
DROP TABLE evidence;
ALTER TABLE evidence_new RENAME TO evidence;
CREATE INDEX idx_evidence_check ON evidence(check_id);
`,
  },
  /*
   * Grounded checks are billed per search query, so this is the line item the
   * owner of the key actually pays. Stored as the queries themselves rather
   * than a count: a verdict built on the wrong sources almost always started
   * with the wrong query, and the count alone cannot show that.
   */
  {
    version: 6,
    name: 'recorded search queries',
    sql: `
ALTER TABLE checks ADD COLUMN search_queries TEXT;
`,
  },
  /*
   * Another CHECK widened, another rebuild: SQLite cannot alter one in place
   * and v5 spelled its list out. `not_checked` is what a seeded or imported
   * citation actually is, as against `blocked`, which claims a fetch was tried.
   */
  {
    version: 7,
    name: 'not_checked fetch status',
    sql: `
CREATE TABLE evidence_v7 (
  id             TEXT PRIMARY KEY,
  check_id       TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  title          TEXT,
  publisher      TEXT,
  published_at   TEXT,
  quoted_text    TEXT,
  tier           TEXT CHECK (tier IN ('primary','major_outlet','secondary','social')),
  fetch_status   TEXT NOT NULL
                   CHECK (fetch_status IN
                     ('ok','facts_found','unreachable','quote_not_found','blocked','not_checked')),
  fetched_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
INSERT INTO evidence_v7 SELECT * FROM evidence;
DROP TABLE evidence;
ALTER TABLE evidence_v7 RENAME TO evidence;
CREATE INDEX idx_evidence_check ON evidence(check_id);
`,
  },
  /*
   * The evidence score is gone. It decided nothing, and the gates were the
   * only part of its breakdown anything read. The column is renamed rather
   * than replaced so existing rows keep their gates (parseGates reads the old
   * object shape). rubric_score and predictions.confidence_score stay in
   * place, unwritten: dropping a column is a table rebuild for no gain.
   */
  {
    version: 8,
    name: 'gates instead of a score, links instead of quotes',
    sql: `
ALTER TABLE checks RENAME COLUMN rubric_breakdown TO gates;
UPDATE evidence SET fetch_status = 'ok' WHERE fetch_status IN ('facts_found', 'quote_not_found');
CREATE TABLE evidence_v8 (
  id             TEXT PRIMARY KEY,
  check_id       TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  title          TEXT,
  publisher      TEXT,
  published_at   TEXT,
  quoted_text    TEXT,
  tier           TEXT CHECK (tier IN ('primary','major_outlet','secondary','social')),
  fetch_status   TEXT NOT NULL CHECK (fetch_status IN ('ok','unreachable','blocked','not_checked')),
  fetched_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
INSERT INTO evidence_v8 SELECT * FROM evidence;
DROP TABLE evidence;
ALTER TABLE evidence_v8 RENAME TO evidence;
CREATE INDEX idx_evidence_check ON evidence(check_id);
`,
  },
];

export function currentVersion(driver: SqlDriver): number {
  const rows = driver.select<{ user_version: number }>('PRAGMA user_version');
  return rows[0]?.user_version ?? 0;
}

export function migrate(driver: SqlDriver): number {
  let version = currentVersion(driver);
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    driver.transaction(() => {
      for (const statement of splitStatements(migration.sql)) driver.run(statement);
    });
    // PRAGMA does not accept bound parameters.
    driver.run(`PRAGMA user_version = ${migration.version}`);
    version = migration.version;
  }
  return version;
}

/**
 * sql.js runs one statement per call, so a migration is split on statement
 * boundaries. Line comments are stripped first so a comment sitting above a
 * statement cannot swallow it. None of our SQL contains `--` inside a string
 * literal, which is what makes this naive split safe.
 */
function splitStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
