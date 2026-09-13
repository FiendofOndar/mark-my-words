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
  for (const entry of rawStatus) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    const index = Number(c.index);
    if (!Number.isInteger(index) || index < 0 || index >= criteriaCount) {
      warnings.push(`Ignored a criterion status pointing at element ${String(c.index)}.`);
      continue;
    }
    criteriaStatus.push({
      index,
      satisfied: c.satisfied === true,
      basis: asEnum(c.basis, ['quoted', 'inferred', 'none'] as const) ?? 'none',
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

/** How well the criteria were actually evidenced, for the rubric. */
/**
 * How completely the criteria were actually established, one way or the other.
 *
 * This used to count only *satisfied* criteria, which meant a correct miss
 * could never earn a point of it: a miss is precisely the case where nothing is
 * satisfied. Fifteen of the hundred were structurally unavailable to every
 * negative verdict, so misses were systematically harder to settle than hits
 * on identical evidence. Three real weather checks scored 0 here while
 * correctly reporting that a 65F day did not reach 85F.
 *
 * Establishing that a criterion was NOT met is the same work as establishing
 * that it was. What matters is whether every criterion got an answer, and
 * whether those answers rest on something quoted rather than inferred.
 *
 * `no_change` keeps the old reading. Nothing has been established yet by
 * definition, and a check that found nothing should not score as though it had.
 */
export function coverageFrom(
  criteriaStatus: CriterionStatus[],
  criteriaCount: number,
  verdict: CheckVerdict = 'no_change',
): 'all_quoted' | 'partial' | 'inferred' | 'none' {
  if (criteriaStatus.length === 0 || criteriaCount === 0) return 'none';

  if (verdict === 'no_change') {
    const satisfied = criteriaStatus.filter((c) => c.satisfied);
    if (satisfied.length === 0) return 'none';
    const allSatisfied = satisfied.length === criteriaCount;
    const allQuoted = satisfied.every((c) => c.basis === 'quoted');
    if (allSatisfied && allQuoted) return 'all_quoted';
    if (allSatisfied) return 'inferred';
    return 'partial';
  }

  const answered = criteriaStatus.filter((c) => c.basis !== 'none');
  if (answered.length === 0) return 'none';
  if (answered.length < criteriaCount) return 'partial';
  return answered.every((c) => c.basis === 'quoted') ? 'all_quoted' : 'inferred';
}
