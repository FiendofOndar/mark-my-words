import type { ExtractedPost } from '../../src/verification/types';

/**
 * The fields a screenshot eval can pin, named as the model's JSON names them
 * so the owner can read a failure against the raw response without
 * translating. A key left out of a case is not checked; a key set to null
 * means the model must return nothing for it.
 */
export interface ExpectedExtract {
  is_prediction?: boolean;
  statement?: string | null;
  author?: string | null;
  platform?: string | null;
  posted_on?: string | null;
  posted_hint?: string | null;
  /**
   * For a post the screen cuts off, where the owner has not yet decided
   * where the statement ends: it must begin with the visible words and be
   * no longer than what was visible. Invented continuation fails both.
   */
  statement_starts_with?: string;
  statement_max_length?: number;
  /**
   * A word the note has to carry. The note is free text, so it is never
   * matched exactly; this pins the one fact the note exists to deliver.
   * Used where the statement alone is not enough to know what was claimed,
   * such as a quote tweet whose subject is only a pronoun.
   */
  note_contains?: string;
}

export interface ExtractCase {
  /** The date the screenshot was taken, so an age like "3h" resolves the same way every run. */
  today?: string;
  expect?: ExpectedExtract;
}

export type ExtractCases = Record<string, ExtractCase>;

export interface FieldDiff {
  field: keyof ExpectedExtract;
  expected: unknown;
  actual: unknown;
}

export type RowStatus = 'pass' | 'fail' | 'unconfirmed' | 'error';

export interface ExtractRow {
  file: string;
  status: RowStatus;
  diffs: FieldDiff[];
  /** What the model said, verbatim, for the owner to confirm or correct. */
  rawText: string | null;
  tokens: number | null;
  error: string | null;
}

/**
 * Whitespace, Unicode form and quote style are not what an eval is testing.
 * Reddit renders a typographic apostrophe where the poster typed a straight
 * one, so "it's" and "it’s" are the same word read off the same screen.
 */
function norm(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A handle or a platform name is the same one whichever case the model
 * chose; a statement is verbatim, so its case stays.
 */
function fold(field: keyof ExpectedExtract, value: unknown): unknown {
  const n = norm(value);
  return typeof n === 'string' && (field === 'author' || field === 'platform') ? n.toLowerCase() : n;
}

export function actualField(post: ExtractedPost, field: keyof ExpectedExtract): unknown {
  switch (field) {
    case 'is_prediction':
      return post.isPrediction;
    case 'statement':
    case 'statement_starts_with':
    case 'statement_max_length':
      return post.statement;
    case 'author':
      return post.author;
    case 'platform':
      return post.platform;
    case 'posted_on':
      return post.postedOn;
    case 'posted_hint':
      return post.postedHint;
    case 'note_contains':
      return post.note;
  }
}

export function compareExtract(expected: ExpectedExtract, post: ExtractedPost): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of Object.keys(expected) as (keyof ExpectedExtract)[]) {
    const want = expected[field];
    const got = actualField(post, field);
    if (field === 'statement_starts_with') {
      const text = norm(got);
      if (typeof text !== 'string' || !text.startsWith(norm(want) as string)) diffs.push({ field, expected: want, actual: got });
    } else if (field === 'note_contains') {
      const text = norm(got);
      const want_l = String(norm(want)).toLowerCase();
      if (typeof text !== 'string' || !text.toLowerCase().includes(want_l)) {
        diffs.push({ field, expected: want, actual: got });
      }
    } else if (field === 'statement_max_length') {
      const text = norm(got);
      if (typeof text !== 'string' || typeof want !== 'number' || text.length > want) {
        diffs.push({ field, expected: want, actual: typeof text === 'string' ? `${text.length} chars` : got });
      }
    } else if (fold(field, want) !== fold(field, got)) {
      diffs.push({ field, expected: want, actual: got });
    }
  }
  return diffs;
}

export function statusOf(expected: ExpectedExtract | undefined, diffs: FieldDiff[]): RowStatus {
  if (!expected || Object.keys(expected).length === 0) return 'unconfirmed';
  return diffs.length === 0 ? 'pass' : 'fail';
}

const show = (value: unknown) => (value === undefined ? '(not checked)' : JSON.stringify(value));

function prettyRaw(rawText: string | null): string {
  if (!rawText) return '(no response text)';
  try {
    return JSON.stringify(JSON.parse(rawText), null, 2);
  } catch {
    return rawText;
  }
}

export function summarize(rows: ExtractRow[]): Record<RowStatus, number> {
  const counts: Record<RowStatus, number> = { pass: 0, fail: 0, unconfirmed: 0, error: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function describe(row: ExtractRow): string {
  if (row.status === 'error') return row.error ?? 'failed';
  if (row.status === 'unconfirmed') return 'no expected values yet';
  if (row.status === 'pass') return 'all expected fields match';
  return row.diffs.map((d) => `${d.field}: expected ${show(d.expected)}, got ${show(d.actual)}`).join('; ');
}

/** The job summary: a table the owner can read on a phone, raw JSON collapsed under every row. */
export function renderMarkdown(rows: ExtractRow[], heading: string): string {
  const counts = summarize(rows);
  const lines: string[] = [
    `## ${heading}`,
    '',
    `${counts.pass} pass, ${counts.fail} fail, ${counts.unconfirmed} unconfirmed, ${counts.error} error.`,
    '',
    '| Screenshot | Result | Detail | Tokens |',
    '|---|---|---|---|',
  ];
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const row of rows) {
    lines.push(`| ${cell(row.file)} | ${row.status} | ${cell(describe(row))} | ${row.tokens ?? ''} |`);
  }
  // Every row, a pass included: a pass on the checked fields says nothing
  // about the note, and the owner reads these to confirm the next values.
  for (const row of rows) {
    lines.push('', '<details>', `<summary>${row.file}: what the model said</summary>`, '', '```json', prettyRaw(row.rawText), '```', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

/** The same thing for a terminal. */
export function renderText(rows: ExtractRow[], heading: string): string {
  const counts = summarize(rows);
  const lines: string[] = [heading, ''];
  for (const row of rows) {
    lines.push(`  ${row.status.padEnd(11)} ${row.file}${row.tokens !== null ? `  (${row.tokens} tokens)` : ''}`);
    lines.push(`              ${describe(row)}`);
    if (row.status !== 'pass') {
      for (const line of prettyRaw(row.rawText).split('\n')) lines.push(`              ${line}`);
    }
  }
  lines.push('', `${counts.pass} pass, ${counts.fail} fail, ${counts.unconfirmed} unconfirmed, ${counts.error} error.`);
  return `${lines.join('\n')}\n`;
}
