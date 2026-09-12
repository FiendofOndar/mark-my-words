/**
 * Scoring a verification result.
 *
 * The number is computed by the app from checkable properties of the evidence,
 * not asked for. A model's self-reported confidence reflects how confident the
 * sentence sounded, so it enters only as a cap: it can pull a score down when
 * the model itself is unsure, and can never push one up.
 */
import type { FetchStatus, PredictionStatus, SourceTier } from './types';

export interface SourceAssessment {
  url: string;
  publisher: string | null;
  tier: SourceTier | null;
  fetchStatus: FetchStatus;
  /** ISO date, or null when the source carried none. */
  publishedAt: string | null;
}

export type CriteriaCoverage = 'all_quoted' | 'partial' | 'inferred' | 'none';

export interface RubricInput {
  sources: SourceAssessment[];
  coverage: CriteriaCoverage;
  /** 0-100, as the model reported it. */
  modelConfidence: number | null;
  /** ISO instant the prediction was made. */
  statementDate: string;
  /** The end of the period the claim covers, for temporal sanity. */
  claimPeriodEnd: string | null;
  proposedVerdict: PredictionStatus | 'no_change';
  forceManual: boolean;
  isRetroactive: boolean;
}

export interface RubricBreakdown {
  independentSources: number;
  sourceTier: number;
  urlValidation: number;
  criteriaCoverage: number;
  temporalSanity: number;
  evidenceTotal: number;
  /** After the model-confidence cap is applied. */
  score: number;
  capApplied: boolean;
}

export interface RubricResult {
  score: number;
  breakdown: RubricBreakdown;
  /** Reasons this result may not auto-resolve, whatever the score. */
  gates: string[];
  decision: 'auto_resolve' | 'queue' | 'hold';
}

export const AUTO_RESOLVE_AT = 95;
export const QUEUE_AT = 80;

const TIER_POINTS: Record<SourceTier, number> = {
  primary: 25,
  major_outlet: 18,
  secondary: 10,
  social: 4,
};

/** Two articles from the same publisher are one source, not two. */
export function countIndependentSources(sources: SourceAssessment[]): number {
  const seen = new Set<string>();
  for (const source of sources) {
    const key = (source.publisher ?? hostOf(source.url) ?? source.url).toLowerCase();
    seen.add(key);
  }
  return seen.size;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function sourceCountPoints(independent: number): number {
  if (independent <= 0) return 0;
  if (independent === 1) return 10;
  if (independent === 2) return 22;
  return 30;
}

function tierPoints(sources: SourceAssessment[]): number {
  let best = 0;
  for (const source of sources) {
    if (!source.tier) continue;
    best = Math.max(best, TIER_POINTS[source.tier]);
  }
  return best;
}

/**
 * `blocked` is not `unreachable`. A bot wall or a CORS refusal means the app
 * could not check the source, which earns nothing but is not evidence that the
 * source is fake. `unreachable` means the URL did not resolve at all, which is
 * the signature of a model inventing a citation.
 */
function validationPoints(sources: SourceAssessment[]): number {
  if (sources.length === 0) return 0;
  if (sources.some((s) => s.fetchStatus === 'unreachable')) return 0;

  const ok = sources.filter((s) => s.fetchStatus === 'ok').length;
  if (ok === sources.length) return 20;
  if (ok * 2 > sources.length) return 10;
  return 0;
}

const COVERAGE_POINTS: Record<CriteriaCoverage, number> = {
  all_quoted: 15,
  partial: 7,
  inferred: 3,
  none: 0,
};

/** Sources predating the claim, or postdating the period it covered, prove nothing. */
function temporalPoints(input: RubricInput): number {
  if (input.sources.length === 0) return 0;

  const statement = new Date(input.statementDate).getTime();
  const periodEnd = input.claimPeriodEnd ? new Date(input.claimPeriodEnd).getTime() : Infinity;

  for (const source of input.sources) {
    if (!source.publishedAt) return 0;
    const published = new Date(source.publishedAt).getTime();
    if (Number.isNaN(published)) return 0;
    if (!input.isRetroactive && published < statement) return 0;
    if (published > periodEnd) return 0;
  }
  return 10;
}

export function scoreCheck(input: RubricInput): RubricResult {
  const independent = countIndependentSources(input.sources);

  const breakdown: RubricBreakdown = {
    independentSources: sourceCountPoints(independent),
    sourceTier: tierPoints(input.sources),
    urlValidation: validationPoints(input.sources),
    criteriaCoverage: COVERAGE_POINTS[input.coverage],
    temporalSanity: temporalPoints(input),
    evidenceTotal: 0,
    score: 0,
    capApplied: false,
  };

  breakdown.evidenceTotal =
    breakdown.independentSources +
    breakdown.sourceTier +
    breakdown.urlValidation +
    breakdown.criteriaCoverage +
    breakdown.temporalSanity;

  const cap = input.modelConfidence === null ? 100 : input.modelConfidence + 20;
  breakdown.score = Math.max(0, Math.min(breakdown.evidenceTotal, cap));
  breakdown.capApplied = cap < breakdown.evidenceTotal;

  const gates = collectGates(input, independent);
  const decision =
    gates.length > 0
      ? breakdown.score >= QUEUE_AT
        ? 'queue'
        : 'hold'
      : breakdown.score >= AUTO_RESOLVE_AT
        ? 'auto_resolve'
        : breakdown.score >= QUEUE_AT
          ? 'queue'
          : 'hold';

  return { score: breakdown.score, breakdown, gates, decision };
}

/** Reasons a result may never auto-resolve, regardless of how well it scored. */
function collectGates(input: RubricInput, independent: number): string[] {
  const gates: string[] = [];

  if (input.proposedVerdict === 'no_change') return ['Nothing resolved.'];
  if (input.forceManual) gates.push('You asked to call this one yourself.');
  if (input.proposedVerdict === 'partial' || input.proposedVerdict === 'ambiguous') {
    gates.push('A partial or ambiguous result is always yours to judge.');
  }
  if (independent < 2) {
    gates.push(
      independent === 0 ? 'No sources were cited.' : 'Only one independent source was cited.',
    );
  }
  if (input.sources.some((s) => s.fetchStatus === 'unreachable')) {
    gates.push('A cited source did not resolve, which is how invented citations look.');
  }

  const statement = new Date(input.statementDate).getTime();
  if (
    !input.isRetroactive &&
    input.sources.some((s) => s.publishedAt && new Date(s.publishedAt).getTime() < statement)
  ) {
    gates.push('A source predates the prediction.');
  }

  return gates;
}
