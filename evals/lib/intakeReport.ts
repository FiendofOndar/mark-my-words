import type { StructuredPrediction } from '../../src/verification/types';

/**
 * The intake eval: raw statements through the app's real structuring path,
 * graded against what the review card must get right.
 *
 * A case pins fields by the model's own JSON names, with a suffix saying
 * how to compare, so the owner can read a failure against the raw response
 * without translating:
 *
 *   "deadline_type": "fixed_date"            exact (strings, booleans, null)
 *   "criteria_elements_contains": ["rogue"]  every word appears, case-insensitive
 *   "ambiguities_contains_any": ["which"]    at least one appears
 *   "criteria_elements_absent": [" or "]     none appears
 *   "criteria_elements_matches": "\\d"       a regular expression matches
 *   "resolution_date_min": "2027-02-01"      at or after (dates compare as text)
 *   "resolution_date_max": "2027-02-28"      at or before
 *   "ambiguities_min": 1                     at least this many items
 *   "ambiguities_max": 0                     at most this many
 *
 * An array field is compared as its items joined by newlines. A key left
 * out is not checked. `null` means the model must return nothing.
 *
 * `proposed` holds values a session drafted and the owner has not yet
 * confirmed. They are never graded: the run reports them beside what the
 * model returned so the owner can confirm or correct in chat, and only then
 * are they moved to `expect`.
 */
export type ExpectedIntake = Record<string, unknown>;

export interface IntakeCase {
  statement: string;
  /** The day the statement was made, so relative dates resolve the same way every run. */
  today: string;
  timezone?: string;
  sourceContext?: string;
  /** Why this statement is in the set. Shown in the table. */
  tests?: string;
  expect?: ExpectedIntake;
  proposed?: ExpectedIntake;
  /**
   * The proposals a reasonable person could answer differently, written as
   * questions for the owner. The review sheet puts these at the top so the
   * other values can be approved in a sentence rather than read one by one.
   */
  ask?: { about?: string; question: string }[];
  /** The reasoning behind the proposal, for the owner to weigh. */
  why?: string;
}

export type IntakeCases = Record<string, IntakeCase>;

const FIELDS: Record<string, keyof StructuredPrediction> = {
  normalized_claim: 'normalizedClaim',
  polarity: 'polarity',
  disconfirming_trigger: 'disconfirmingTrigger',
  criteria_elements: 'criteriaElements',
  deadline_type: 'deadlineType',
  resolution_date: 'resolutionDate',
  window_start: 'windowStart',
  window_end: 'windowEnd',
  trigger_event: 'triggerEvent',
  trigger_expected_date: 'triggerExpectedDate',
  race_event_b: 'raceEventB',
  stale_out_date: 'staleOutDate',
  deadline_reasoning: 'deadlineReasoning',
  verifiability: 'verifiability',
  verifiability_reasoning: 'verifiabilityReasoning',
  search_queries: 'searchQueries',
  no_check_before: 'noCheckBefore',
  can_happen_late: 'canHappenLate',
  category: 'category',
  tags: 'tags',
  author_guess: 'authorGuess',
  statement_date_guess: 'statementDateGuess',
  ambiguities: 'ambiguities',
};

const SUFFIXES = ['_contains_any', '_contains', '_absent', '_matches', '_min', '_max'] as const;
type Suffix = (typeof SUFFIXES)[number] | '';

export interface ParsedKey {
  field: string;
  suffix: Suffix;
}

/** "criteria_elements_contains" -> field criteria_elements, suffix _contains. */
export function parseKey(key: string): ParsedKey | null {
  for (const suffix of SUFFIXES) {
    if (key.endsWith(suffix)) {
      const field = key.slice(0, -suffix.length);
      if (field in FIELDS) return { field, suffix };
    }
  }
  return key in FIELDS ? { field: key, suffix: '' } : null;
}

export function actualValue(value: StructuredPrediction, field: string): unknown {
  const prop = FIELDS[field];
  return prop === undefined ? undefined : value[prop];
}

function norm(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .normalize('NFC')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The searchable text of a field: a string as is, an array joined, anything else stringified. */
function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(norm(v))).join('\n');
  if (value === null || value === undefined) return '';
  return String(norm(value));
}

/**
 * A needle keeps its edges. `norm` trims, and a needle whose whole point is
 * its surrounding spaces (" or ") silently became "or", which is inside
 * "for", "more" and "world". On run 15 that failed a correct Mariners
 * criterion on `criteria_elements_absent: [" or "]` because the criterion
 * said "champions for the 2026 season", and the Cardinals case passed the
 * same check only because its wording happened to carry no "or" at all.
 */
function normNeedle(value: unknown): string {
  return String(value)
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const list = (want: unknown): string[] => (Array.isArray(want) ? want.map(String) : [String(want)]);

export interface IntakeDiff {
  key: string;
  expected: unknown;
  actual: unknown;
}

export function compareIntake(expected: ExpectedIntake, value: StructuredPrediction): IntakeDiff[] {
  const diffs: IntakeDiff[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const parsed = parseKey(key);
    if (!parsed) {
      diffs.push({ key, expected: want, actual: '(not a field the eval knows)' });
      continue;
    }
    const got = actualValue(value, parsed.field);
    const text = textOf(got).toLowerCase();
    let ok: boolean;
    switch (parsed.suffix) {
      case '':
        ok = typeof want === 'string' && typeof got === 'string' ? norm(want) === norm(got) : want === got;
        break;
      case '_contains':
        ok = list(want).every((w) => text.includes(normNeedle(w)));
        break;
      case '_contains_any':
        ok = list(want).some((w) => text.includes(normNeedle(w)));
        break;
      case '_absent':
        ok = list(want).every((w) => !text.includes(normNeedle(w)));
        break;
      case '_matches':
        ok = new RegExp(String(want), 'i').test(textOf(got));
        break;
      case '_min':
        ok = Array.isArray(got) ? got.length >= Number(want) : typeof got === 'string' && got >= String(want);
        break;
      case '_max':
        ok = Array.isArray(got) ? got.length <= Number(want) : typeof got === 'string' && got <= String(want);
        break;
    }
    if (!ok) diffs.push({ key, expected: want, actual: got });
  }
  return diffs;
}

export type RowStatus = 'pass' | 'fail' | 'unconfirmed' | 'error';

export interface IntakeRow {
  id: string;
  statement: string;
  tests: string | null;
  status: RowStatus;
  diffs: IntakeDiff[];
  /** How the proposal fared, for a case not yet confirmed. Never affects the status. */
  proposalDiffs: IntakeDiff[];
  proposedCount: number;
  /** The reading the app would store, plus the repairs the parser made. */
  value: StructuredPrediction | null;
  warnings: string[];
  tokens: number | null;
  error: string | null;
}

export function statusOf(expected: ExpectedIntake | undefined, diffs: IntakeDiff[]): RowStatus {
  if (!expected || Object.keys(expected).length === 0) return 'unconfirmed';
  return diffs.length === 0 ? 'pass' : 'fail';
}

const show = (value: unknown) => (value === undefined ? '(not checked)' : JSON.stringify(value));

export function summarize(rows: IntakeRow[]): Record<RowStatus, number> {
  const counts: Record<RowStatus, number> = { pass: 0, fail: 0, unconfirmed: 0, error: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function describe(row: IntakeRow): string {
  if (row.status === 'error') return row.error ?? 'failed';
  if (row.status === 'unconfirmed') {
    if (row.proposedCount === 0) return 'no expected values yet';
    const agreed = row.proposedCount - row.proposalDiffs.length;
    return `proposal: ${agreed} of ${row.proposedCount} agree${
      row.proposalDiffs.length > 0 ? `; differs on ${row.proposalDiffs.map((d) => d.key).join(', ')}` : ''
    }`;
  }
  if (row.status === 'pass') return 'all expected fields match';
  return row.diffs.map((d) => `${d.key}: expected ${show(d.expected)}, got ${show(d.actual)}`).join('; ');
}

function prettyValue(row: IntakeRow): string {
  if (!row.value) return '(no reading)';
  return JSON.stringify({ ...row.value, parser_warnings: row.warnings }, null, 2);
}

/** The job summary, phone-readable: a table, then the stored reading collapsed under every row. */
export function renderMarkdown(rows: IntakeRow[], heading: string): string {
  const counts = summarize(rows);
  const lines: string[] = [
    `## ${heading}`,
    '',
    `${counts.pass} pass, ${counts.fail} fail, ${counts.unconfirmed} unconfirmed, ${counts.error} error.`,
    '',
    '| Case | Result | Detail | Tokens |',
    '|---|---|---|---|',
  ];
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const row of rows) {
    lines.push(`| ${cell(row.id)} | ${row.status} | ${cell(describe(row))} | ${row.tokens ?? ''} |`);
  }
  for (const row of rows) {
    lines.push('', '<details>', `<summary>${row.id}: what the app would store</summary>`, '');
    lines.push(`> ${cell(row.statement)}`, '');
    if (row.tests) lines.push(`Tests: ${cell(row.tests)}`, '');
    if (row.proposalDiffs.length > 0) {
      lines.push('Proposal differs on:', '');
      for (const d of row.proposalDiffs) lines.push(`- ${d.key}: proposed ${show(d.expected)}, got ${show(d.actual)}`);
      lines.push('');
    }
    lines.push('```json', prettyValue(row), '```', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

export function renderText(rows: IntakeRow[], heading: string): string {
  const counts = summarize(rows);
  const lines: string[] = [heading, ''];
  for (const row of rows) {
    lines.push(`  ${row.status.padEnd(11)} ${row.id}${row.tokens !== null ? `  (${row.tokens} tokens)` : ''}`);
    lines.push(`              ${describe(row)}`);
    if (row.status !== 'pass') {
      for (const d of row.proposalDiffs) lines.push(`              proposed ${d.key} ${show(d.expected)}, got ${show(d.actual)}`);
      for (const line of prettyValue(row).split('\n')) lines.push(`              ${line}`);
    }
  }
  lines.push('', `${counts.pass} pass, ${counts.fail} fail, ${counts.unconfirmed} unconfirmed, ${counts.error} error.`);
  return `${lines.join('\n')}\n`;
}
