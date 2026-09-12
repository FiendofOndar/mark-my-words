import type { StructureInput, StructureResult, Verifier } from './types';
import { parseStructuredPrediction } from './structureSchema';
import { CATEGORIES, type Category } from '../domain/types';

/**
 * A keyless fallback that reads a statement with regexes instead of a model.
 *
 * It exists so the app is usable and testable before a key is entered. It is
 * not AI and the UI says so: it guesses a deadline and copies the statement
 * into a single criterion, which is exactly the vague criterion the real
 * intake pass is supposed to replace.
 */
export class MockVerifier implements Verifier {
  readonly providerId = 'mock';
  readonly modelId = 'offline-heuristics';
  readonly dailyQuota = null;

  async structure(input: StructureInput): Promise<StructureResult> {
    const text = stripPreamble(input.rawStatement);
    // The preamble has to go before any keyword matching, or "Mark my words"
    // reads as a first-person claim about the speaker's own life.
    const lower = text.toLowerCase();

    const negative = /\b(will not|won't|wont|never|no longer|leave me alone|stop)\b/.test(lower);
    const personal =
      /\b(my|our|neighbou?rs?|wife|husband|kid|landlord|roommate|gutters|i bet)\b/.test(lower);

    const deadline = guessDeadline(lower, input.today);
    const category = guessCategory(lower);

    const parsed = parseStructuredPrediction(
      {
        normalized_claim: text,
        polarity: negative ? 'negative' : 'positive',
        disconfirming_trigger: negative
          ? 'Any clear sign of the thing happening after all'
          : null,
        criteria_elements: [text],
        deadline_type: 'fixed_date',
        resolution_date: deadline.date,
        deadline_reasoning: deadline.reasoning,
        verifiability: personal ? 'manual' : 'searchable',
        verifiability_reasoning: personal
          ? 'Mentions private life, so no public source would report the outcome.'
          : 'Assumed public. Offline drafting cannot judge this properly.',
        search_queries: [],
        category,
        tags: [],
        ambiguities: [
          'This draft came from offline pattern matching, not a model. Check the deadline and rewrite the criteria into something a search could actually settle.',
        ],
      },
      { today: input.today },
    );

    if (!parsed.ok) throw new Error(parsed.problems.join(' '));

    return {
      value: parsed.value,
      warnings: ['Drafted offline without a model. Everything here is a guess.'],
      provider: this.providerId,
      model: this.modelId,
      tokensUsed: null,
    };
  }

  async testConnection(): Promise<void> {
    /* nothing to reach */
  }
}

/** "Mark my words, X" and friends are framing, not part of the claim. */
function stripPreamble(statement: string): string {
  return statement
    .replace(/^\s*(mark my words|you heard it here first|i'?m telling you|calling it now)[,:]?\s*/i, '')
    .trim();
}

function addDays(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function guessDeadline(lower: string, today: string): { date: string; reasoning: string } {
  const relative = lower.match(/\b(?:in|within|next)\s+(?:the\s+)?(\d+)\s+(day|week|month|year)s?\b/);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2] as 'day' | 'week' | 'month' | 'year';
    const days = { day: 1, week: 7, month: 30, year: 365 }[unit] * n;
    return {
      date: addDays(today, days),
      reasoning: `Read "${relative[0]}" as ${days} days from ${today}.`,
    };
  }

  if (/\bthis year\b/.test(lower)) {
    return { date: `${today.slice(0, 4)}-12-31`, reasoning: 'Read "this year" as the end of the calendar year.' };
  }
  if (/\bnext year\b/.test(lower)) {
    return {
      date: `${Number(today.slice(0, 4)) + 1}-12-31`,
      reasoning: 'Read "next year" as the end of next calendar year.',
    };
  }
  if (/\bby halloween\b/.test(lower)) {
    return { date: `${today.slice(0, 4)}-10-31`, reasoning: 'Read "by Halloween" as October 31.' };
  }

  return {
    date: addDays(today, 365),
    reasoning: 'No timeframe found, so this defaulted to one year out. Change it.',
  };
}

// Ordered most specific first. Market words beat the bare token "ai", so
// "the AI bubble will crash" files under Economics rather than Tech/AI.
const CATEGORY_HINTS: [RegExp, Category][] = [
  [/\b(series|playoffs?|super bowl|cardinals|chiefs|season|league|nfl|mlb|nba)\b/, 'Sports'],
  [/\b(bubble|crash|market|recession|inflation|stock|bitcoin|economy)\b/, 'Economics'],
  [/\b(ai|drone|model|chip|robot|software|app|startup|tech)\b/, 'Tech/AI'],
  [/\b(election|senate|congress|president|vote|policy|governor)\b/, 'Politics'],
  [/\b(winter|summer|snow|hurricane|storm|drought|climate|rain)\b/, 'Weather/Climate'],
  [/\b(movie|film|season|marvel|avengers|album|show|series finale)\b/, 'Entertainment'],
  [/\b(neighbou?rs?|gutters|my|our|landlord|roommate)\b/, 'Personal'],
];

function guessCategory(lower: string): Category {
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(lower)) return category;
  }
  return CATEGORIES[CATEGORIES.length - 1] as Category;
}
