import type { StructuredPrediction } from '../../src/verification/types';
import { actualValue, compareIntake, parseKey, type ExpectedIntake, type IntakeCases } from './intakeReport';

/**
 * The review sheet: every value a session has proposed, in plain English,
 * beside what the model actually returned.
 *
 * The owner reads this on a phone and answers. The raw readings are the
 * wrong surface for that: eighteen JSON objects of twenty-odd fields each,
 * in a comment nearly a thousand lines long, with the case file open in
 * another tab to compare against. This renders one line per value and puts
 * the handful that need a judgment at the top, so the rest can be approved
 * in a sentence.
 */

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [String(v)]);
const quoted = (v: unknown): string => listOf(v).map((s) => `"${s}"`).join(', ');
const yesNo = (v: unknown): string => (v === true ? 'yes' : v === false ? 'no' : String(v));

/** Fields whose _min/_max bound a count rather than a date. */
const COUNTED = new Set(['ambiguities', 'criteria_elements', 'search_queries', 'tags']);

/** Date fields as a person would name them, for the bounded comparisons. */
const DATE_NOUN: Record<string, string> = {
  resolution_date: 'The deadline',
  window_start: 'The window opening',
  window_end: 'The window closing',
  trigger_expected_date: 'The expected date',
  stale_out_date: 'The give-up date',
  no_check_before: 'The earliest check',
  statement_date_guess: 'The date it was said',
};

const SHAPE: Record<string, string> = {
  fixed_date: 'a fixed date',
  window: 'a window',
  event: 'an event',
};

/** What a case key is claiming, as a sentence someone can agree or disagree with. */
export function describeKey(key: string, want: unknown): string {
  const parsed = parseKey(key);
  if (!parsed) return `${key} is ${JSON.stringify(want)}`;
  const { field, suffix } = parsed;

  const noun: Record<string, string> = {
    criteria_elements: 'The criteria',
    ambiguities: 'The questions',
    disconfirming_trigger: 'The disconfirming trigger',
    trigger_event: 'The triggering event',
    race_event_b: 'The competing event',
    normalized_claim: 'The testable version',
    deadline_reasoning: 'The deadline reasoning',
    search_queries: 'The search queries',
  };
  const subject = noun[field] ?? field;

  switch (suffix) {
    case '_contains':
      return `${subject} mention ${quoted(want)}`;
    case '_contains_any':
      return `${subject} mention at least one of ${quoted(want)}`;
    case '_absent':
      return `${subject} never say ${quoted(want)}`;
    case '_matches':
      return `${subject} match the pattern \`${want}\``;
    case '_min':
      return COUNTED.has(field) ? `${subject} number at least ${want}` : `${DATE_NOUN[field] ?? field} is on or after ${want}`;
    case '_max':
      return COUNTED.has(field) ? `${subject} number at most ${want}` : `${DATE_NOUN[field] ?? field} is on or before ${want}`;
  }

  switch (field) {
    case 'deadline_type':
      return `The deadline is ${SHAPE[String(want)] ?? want}`;
    case 'resolution_date':
      return `The deadline is ${want}`;
    case 'window_start':
      return `The window opens ${want}`;
    case 'window_end':
      return `The window closes ${want}`;
    case 'can_happen_late':
      return `It could still come true after the deadline: ${yesNo(want)}`;
    case 'polarity':
      return want === 'negative' ? 'It is a claim that something will NOT happen' : 'It is a claim that something WILL happen';
    case 'verifiability':
      return want === 'manual' ? 'Only you can settle it, not a search' : 'A search can settle it';
    case 'category':
      return `Filed under ${want}`;
    default:
      return `${field} is ${JSON.stringify(want)}`;
  }
}

/** The model's own words for that key: the matched fragment, or the whole value. */
export function showActual(key: string, want: unknown, reading: StructuredPrediction): string {
  const parsed = parseKey(key);
  if (!parsed) return '';
  const got = actualValue(reading, parsed.field);
  const text = Array.isArray(got) ? got.join(' / ') : got === null || got === undefined ? '' : String(got);

  if (text === '') return '_nothing_';

  if (parsed.suffix === '_contains' || parsed.suffix === '_contains_any' || parsed.suffix === '_matches') {
    const needles = parsed.suffix === '_matches' ? [] : listOf(want);
    for (const n of needles) {
      const at = text.toLowerCase().indexOf(n.toLowerCase().trim());
      if (at >= 0) return `…${trim(text.slice(Math.max(0, at - 40), at + n.length + 45))}…`;
    }
    if (parsed.suffix === '_matches') {
      const m = new RegExp(String(want), 'i').exec(text);
      if (m) {
        const at = m.index;
        return `…${trim(text.slice(Math.max(0, at - 40), at + m[0].length + 45))}…`;
      }
    }
  }

  return text.length > 140 ? `${trim(text.slice(0, 140))}…` : trim(text);
}

const trim = (s: string) => s.replace(/\s+/g, ' ').trim();
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export interface ReviewOptions {
  heading: string;
  /** Where the readings came from, so the owner knows what they are judging. */
  provenance: string;
}

export function renderReview(
  cases: IntakeCases,
  readings: Record<string, StructuredPrediction>,
  opts: ReviewOptions,
): string {
  const out: string[] = [`## ${opts.heading}`, '', opts.provenance, ''];

  const asks: { id: string; about?: string; question: string }[] = [];
  for (const [id, c] of Object.entries(cases)) {
    for (const a of (c as { ask?: { about?: string; question: string }[] }).ask ?? []) {
      asks.push({ id, about: a.about, question: a.question });
    }
  }

  const proposedCount = Object.values(cases).reduce((n, c) => n + Object.keys(c.proposed ?? {}).length, 0);

  out.push(
    `There are ${proposedCount} proposed values here and ${asks.length} of them need a judgment. Everything else has one sensible answer and the model gave it.`,
    '',
    `**The short version:** read the ${asks.length} questions below, answer the ones you disagree with, and say "the rest are fine". That approves the other values as they stand and they start grading.`,
    '',
    '---',
    '',
    `## The ${asks.length} that need you`,
    '',
  );

  asks.forEach((a, i) => {
    const c = cases[a.id]!;
    out.push(`**${i + 1}. ${a.id}**${a.about ? ` — \`${a.about}\`` : ''}`, '');
    out.push(`> ${cell(c.statement)}`, '');
    out.push(a.question, '');
    if (a.about && c.proposed?.[a.about] !== undefined) {
      const reading = readings[a.id];
      out.push(
        `Proposing: ${describeKey(a.about, c.proposed[a.about])}.` +
          (reading ? ` Model returned: ${showActual(a.about, c.proposed[a.about], reading)}` : ''),
        '',
      );
    }
  });

  out.push('---', '', '## Everything else, one case at a time', '');
  out.push('A tick means the model already returns what the case proposes. Nothing here changed between the last two runs.', '');

  for (const [id, c] of Object.entries(cases)) {
    const reading = readings[id];
    const expect = (c.expect ?? {}) as ExpectedIntake;
    const proposed = (c.proposed ?? {}) as ExpectedIntake;
    if (Object.keys(expect).length === 0 && Object.keys(proposed).length === 0) continue;

    out.push(`### ${id}`, '', `> ${cell(c.statement)}`, '', `Said ${c.today}.${c.tests ? ` Tests ${cell(c.tests)}.` : ''}`, '');

    const render = (values: ExpectedIntake, graded: boolean) => {
      for (const [k, want] of Object.entries(values)) {
        const agrees = reading ? compareIntake({ [k]: want }, reading).length === 0 : false;
        const mark = graded ? '**graded**' : agrees ? 'ok' : '**differs**';
        const actual = reading ? showActual(k, want, reading) : '_no reading_';
        out.push(`- ${mark} — ${describeKey(k, want)} — model: ${cell(actual)}`);
      }
    };
    render(expect, true);
    render(proposed, false);
    out.push('');
  }

  return `${out.join('\n')}\n`;
}
