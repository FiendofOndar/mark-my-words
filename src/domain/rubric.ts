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

/**
 * Below this the model is telling you it is torn, and the prompt's own anchors
 * say so: 70-89 is "the verdict is right as far as you can tell", 40-69 is
 * "genuinely torn". Being told the answer is uncertain is a reason to ask a
 * person, which is the one place self-reported confidence is worth acting on.
 */
export const CONFIDENT_AT = 70;

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
/**
 * How much confirmed corroboration the app found for itself.
 *
 * Counted, not averaged. This was a ratio, which punished a model for showing
 * its work: four citations with two confirmed scored 8, where the same two
 * cited alone scored 20. Adding a source that later went stale could only ever
 * lower the score, which is the opposite of what citing more sources means.
 *
 * Volume is already paid for by `independentSources`. What this line is for is
 * whether the app could stand up any of it without taking the model's word,
 * and two independent publishers confirmed on the page is a real answer to
 * that however many extra links came along.
 */
function validationPoints(sources: SourceAssessment[]): number {
  if (sources.length === 0) return 0;

  // A URL that does not resolve is the signature of an invented citation, and
  // it poisons the set: nothing here is trustworthy if one of them is fiction.
  if (sources.some((s) => s.fetchStatus === 'unreachable')) return 0;

  const confirmed = countIndependentSources(sources.filter((s) => s.fetchStatus === 'ok'));
  if (confirmed >= 2) return 20;
  if (confirmed === 1) return 12;

  /*
   * Nothing confirmed, but every page was read. Weak evidence, not no evidence:
   * these all served content. Live pages rewrite themselves between the model
   * reading them and the app fetching them minutes later, so a forecast page
   * that has rolled over should not score the same as a fabrication.
   *
   * `blocked` earns nothing even here, because the page was never read at all,
   * and in the browser it cannot be told apart from a dead host.
   */
  if (sources.every((s) => s.fetchStatus === 'quote_not_found')) return 4;
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

  /*
   * The verdict decides. The score describes.
   *
   * This used to require the score to clear 95 before acting, which meant the
   * app could get the right answer and refuse to use it: a correct miss was
   * filed as "no change" because two cited pages had been rewritten since the
   * model read them and a third URL 404'd. That score measures whether the
   * citations check out. It was being read as though it measured whether the
   * answer is right, and those are different questions.
   *
   * So the score is now information on the check log, and two things still
   * stand between a verdict and the record:
   *
   *   - a gate, which is something the app actively noticed was wrong (a dead
   *     link, a source older than the claim, one lone source, a verdict that is
   *     not decisive, or the user asking to judge this one themselves)
   *   - the model saying it is unsure
   *
   * Either of those asks the user rather than acting. Neither buries the
   * finding: `hold` is now reachable only for a check that resolved nothing.
   */
  const unsure = input.modelConfidence !== null && input.modelConfidence < CONFIDENT_AT;
  const decision =
    input.proposedVerdict === 'no_change'
      ? 'hold'
      : gates.length > 0 || unsure
        ? 'queue'
        : 'auto_resolve';

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
