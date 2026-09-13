/**
 * Parsing a verification response. Same contract as the intake parser: repair
 * what is safely repairable, reject what cannot be trusted, and never silently
 * upgrade a weak answer into a strong one.
 */
import type { SourceTier, Trend } from '../domain/types';
import type { CheckResult, CheckVerdict, CitedSource, CriterionStatus } from './types';

export type CheckParseResult =
  | { ok: true; value: Omit<CheckResult, 'provider' | 'model' | 'tokensUsed'>; warnings: string[] }
  | { ok: false; problems: string[] };

/**
 * Everything past this is stored, fetched and rendered for nothing. Three
 * independent sources is already full marks, so eight leaves room for
 * duplicates and near-misses without letting a runaway response turn into
 * dozens of page fetches. The prompt asks for restraint; this is the part that
 * does not depend on the model agreeing.
 */
const MAX_SOURCES = 8;

const VERDICTS: CheckVerdict[] = ['hit', 'miss', 'partial', 'ambiguous', 'no_change'];
const TRENDS: Trend[] = ['toward_yes', 'toward_no', 'flat', 'unknown'];
const TIERS: SourceTier[] = ['primary', 'major_outlet', 'secondary', 'social'];

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const raw = asString(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return null;
  return allowed.find((option) => option === raw) ?? null;
}

function asDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const datePart = raw.replace(/\//g, '-').split('T')[0];
  if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** A URL we could not parse is a URL we cannot fetch, so it is not a source. */
function usableUrl(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseCheckResponse(raw: unknown, criteriaCount: number): CheckParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: ['The model did not return a JSON object.'] };
  }

  const input = raw as Record<string, unknown>;
  const problems: string[] = [];
  const warnings: string[] = [];

  const verdict = asEnum(input.verdict, VERDICTS);
  if (!verdict) problems.push('No usable verdict was returned.');

  const summary = asString(input.summary);
  if (!summary) problems.push('No summary of the findings was returned.');

  let trend = asEnum(input.trend, TRENDS);
  if (!trend) {
    trend = 'unknown';
    warnings.push('No trend was returned.');
  }

  const sources: CitedSource[] = [];
  const rawSources = Array.isArray(input.sources) ? input.sources : [];
  if (rawSources.length > MAX_SOURCES) {
    warnings.push(
      `${rawSources.length} sources came back; only the first ${MAX_SOURCES} were kept.`,
    );
  }
  for (const entry of rawSources.slice(0, MAX_SOURCES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const s = entry as Record<string, unknown>;

    const url = usableUrl(s.url);
    if (!url) {
      warnings.push(`Dropped a citation with an unusable URL: ${String(s.url ?? 'missing')}`);
      continue;
    }
    const quotedText = asString(s.quoted_text ?? s.quotedText);
    if (!quotedText) {
      warnings.push(`Dropped a citation with no quoted passage: ${url}`);
      continue;
    }

    sources.push({
      url,
      title: asString(s.title),
      publisher: asString(s.publisher),
      publishedAt: asDate(s.published_at ?? s.publishedAt),
      quotedText,
      tier: asEnum(s.tier, TIERS) ?? 'secondary',
    });
  }

  const criteriaStatus: CriterionStatus[] = [];
  const rawStatus = Array.isArray(input.criteria_status ?? input.criteriaStatus)
    ? ((input.criteria_status ?? input.criteriaStatus) as unknown[])
    : [];
  /*
   * The prompt lists the criteria as 1., 2., 3. and asks for them back by
   * number, so the wire format is 1-based. This parsed it as 0-based for as
   * long as the feature existed: on a one-criterion prediction the model's 1
   * was out of range and dropped, so coverage read 0/15 on correct checks, and
   * on a two-criterion one its 1 marked the second criterion and its 2 was
   * discarded, so a HIT showed its headline criterion unticked.
   *
   * A response that uses 0 anywhere is 0-based whatever the prompt said, and
   * is taken as it is rather than shifted off the end.
   */
  const entries = rawStatus.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  );
  const zeroBased = entries.some((c) => Number(c.index) === 0);
  for (const c of entries) {
    const raw = Number(c.index);
    const index = zeroBased ? raw : raw - 1;
    if (!Number.isInteger(index) || index < 0 || index >= criteriaCount) {
      warnings.push(`Ignored a criterion status pointing at element ${String(c.index)}.`);
      continue;
    }
    criteriaStatus.push({
      index,
      satisfied: c.satisfied === true,
      why: asString(c.why) ?? '',
    });
  }

  const confidenceRaw = Number(input.model_confidence ?? input.modelConfidence);
  const modelConfidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, Math.round(confidenceRaw)))
    : null;
  if (modelConfidence === null) warnings.push('No confidence was returned.');

  // A verdict with nothing behind it is not a verdict. Downgrading here rather
  // than rejecting keeps the check on the record, which is what the log is for.
  if (verdict && verdict !== 'no_change' && sources.length === 0) {
    warnings.push(`A verdict of "${verdict}" arrived with no usable sources, so it was held open.`);
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    warnings,
    value: {
      verdict: sources.length === 0 && verdict !== 'no_change' ? 'no_change' : verdict!,
      trend,
      summary: summary!,
      criteriaStatus,
      sources,
      modelConfidence,
    },
  };
}
