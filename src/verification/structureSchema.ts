/**
 * Turning whatever the model returned into something the app can store.
 *
 * Models return almost-right JSON: fenced in markdown, an enum spelled
 * differently, a date with a time on it, a single string where an array was
 * asked for. Repairing those is fine as long as the repair is visible, so this
 * separates warnings (repaired, carry on) from problems (cannot proceed).
 */
import { CATEGORIES, type Category, type DeadlineType, type Polarity, type VerificationMode } from '../domain/types';
import type { StructuredPrediction } from './types';

export type ParseResult =
  | { ok: true; value: StructuredPrediction; warnings: string[] }
  | { ok: false; problems: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Pull the JSON body out of a response that may be fenced or padded with prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost braces, which survives a stray preamble.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new SyntaxError('No JSON object in the response');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString).filter((v): v is string => v !== null);
  }
  const single = asString(value);
  return single ? [single] : [];
}

/** Accepts "2027-03-20", "2027-03-20T00:00:00Z", and "2027/03/20". */
function asDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;

  const normalized = raw.replace(/\//g, '-');
  if (DATE_RE.test(normalized)) return normalized;

  const datePart = normalized.split('T')[0];
  if (datePart && DATE_RE.test(datePart)) return datePart;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addYears(isoDate: string, years: number): string {
  const parts = isoDate.split('-').map(Number);
  const [y, m, d] = [parts[0] ?? 1970, parts[1] ?? 1, parts[2] ?? 1];
  return `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const POLARITIES: Polarity[] = ['positive', 'negative'];
const DEADLINE_TYPES: DeadlineType[] = ['fixed_date', 'window', 'event'];
const MODES: VerificationMode[] = ['searchable', 'manual'];

/** Enum values arrive with different casing and spacing than requested. */
function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const raw = asString(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return null;
  return allowed.find((option) => option.toLowerCase() === raw) ?? null;
}

function asCategory(value: unknown): Category | null {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return null;
  return CATEGORIES.find((c) => c.toLowerCase() === raw) ?? null;
}

export const DEFAULT_STALE_OUT_YEARS = 5;

export function parseStructuredPrediction(
  raw: unknown,
  ctx: { today: string },
): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: ['The model did not return a JSON object.'] };
  }

  const input = raw as Record<string, unknown>;
  const problems: string[] = [];
  const warnings: string[] = [];

  const normalizedClaim = asString(input.normalized_claim ?? input.normalizedClaim);
  if (!normalizedClaim) problems.push('No claim was returned.');

  const criteriaElements = asStringArray(input.criteria_elements ?? input.criteriaElements);
  if (criteriaElements.length === 0) problems.push('No resolution criteria were returned.');

  let polarity = asEnum(input.polarity, POLARITIES);
  if (!polarity) {
    polarity = 'positive';
    warnings.push('Polarity was missing, assumed the claim is that something will happen.');
  }

  const disconfirmingTrigger = asString(
    input.disconfirming_trigger ?? input.disconfirmingTrigger,
  );
  if (polarity === 'negative' && !disconfirmingTrigger) {
    problems.push(
      'This is a claim that something will not happen, but no disconfirming event was given. There is nothing to search for.',
    );
  }

  let deadlineType = asEnum(input.deadline_type ?? input.deadlineType, DEADLINE_TYPES);
  if (!deadlineType) {
    deadlineType = 'fixed_date';
    warnings.push('Deadline type was missing, treated as a fixed date.');
  }

  const resolutionDate = asDate(input.resolution_date ?? input.resolutionDate);
  const windowStart = asDate(input.window_start ?? input.windowStart);
  const windowEnd = asDate(input.window_end ?? input.windowEnd);
  const triggerEvent = asString(input.trigger_event ?? input.triggerEvent);
  const triggerExpectedDate = asDate(input.trigger_expected_date ?? input.triggerExpectedDate);
  const raceEventB = asString(input.race_event_b ?? input.raceEventB);
  let staleOutDate = asDate(input.stale_out_date ?? input.staleOutDate);

  if (deadlineType === 'fixed_date' && !resolutionDate) {
    problems.push('A fixed-date claim came back with no date.');
  }
  if (deadlineType === 'window') {
    if (!windowStart || !windowEnd) {
      problems.push('A windowed claim needs both a start and an end.');
    } else if (windowStart > windowEnd) {
      problems.push('The window ends before it starts.');
    }
  }
  if (deadlineType === 'event') {
    if (!triggerEvent) problems.push('An event-triggered claim came back with no triggering event.');
    if (!staleOutDate) {
      staleOutDate = addYears(ctx.today, DEFAULT_STALE_OUT_YEARS);
      warnings.push(
        `No stale-out date was given, defaulted to ${DEFAULT_STALE_OUT_YEARS} years out so it cannot hang in the feed forever.`,
      );
    }
  }

  let verifiability = asEnum(input.verifiability, MODES);
  if (!verifiability) {
    verifiability = 'searchable';
    warnings.push('Verifiability was missing, assumed it can be checked by search.');
  }

  let category = asCategory(input.category);
  if (!category) {
    category = 'Other';
    if (input.category !== undefined) {
      warnings.push(`Category "${String(input.category)}" is not in the taxonomy, filed as Other.`);
    }
  }

  const noCheckBefore = asDate(input.no_check_before ?? input.noCheckBefore);

  // Whether the claim can still come true after its deadline. When the model
  // does not say, fall back to the shape: event-shaped claims can, dated ones
  // usually cannot.
  const lateRaw = input.can_happen_late ?? input.canHappenLate;
  const canHappenLate =
    typeof lateRaw === 'boolean'
      ? lateRaw
      : typeof lateRaw === 'string'
        ? lateRaw.trim().toLowerCase() === 'true'
        : deadlineType === 'event';

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    warnings,
    value: {
      normalizedClaim: normalizedClaim!,
      polarity,
      disconfirmingTrigger,
      criteriaElements,
      deadlineType,
      resolutionDate,
      windowStart,
      windowEnd,
      triggerEvent,
      triggerExpectedDate,
      raceEventB,
      staleOutDate,
      deadlineReasoning: asString(input.deadline_reasoning ?? input.deadlineReasoning) ?? '',
      verifiability,
      verifiabilityReasoning:
        asString(input.verifiability_reasoning ?? input.verifiabilityReasoning) ?? '',
      searchQueries: asStringArray(input.search_queries ?? input.searchQueries),
      noCheckBefore,
      canHappenLate,
      category,
      tags: asStringArray(input.tags),
      authorGuess: asString(input.author_guess ?? input.authorGuess),
      statementDateGuess: asDate(input.statement_date_guess ?? input.statementDateGuess),
      ambiguities: asStringArray(input.ambiguities),
    },
  };
}
