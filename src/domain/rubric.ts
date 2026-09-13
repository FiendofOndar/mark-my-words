/**
 * Scoring a verification result.
 *
 * The number is computed by the app from checkable properties of the evidence,
 * not asked for. A model's self-reported confidence reflects how confident the
 * sentence sounded, so it enters only as a cap: it can pull a score down when
 * the model itself is unsure, and can never push one up.
 */
import type { FetchStatus, PredictionStatus, SourceTier } from './types';
import { publisherMismatch, registrableDomain, tierForUrl } from './sources';

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

/**
 * Two articles from the same outlet are one source, not two.
 *
 * Keyed on the domain, not on the publisher name. The name is a field in the
 * model's own JSON, so two pages on one site labelled "AP" and "Reuters"
 * counted as two independent sources and earned the full thirty points for it.
 * The domain is the part of a citation that cannot be typed into existence.
 */
export function countIndependentSources(sources: SourceAssessment[]): number {
  const seen = new Set<string>();
  for (const source of sources) {
    // A page that does not exist corroborates nothing. It used to earn its
    // domain a place in this count anyway.
    if (source.fetchStatus === 'unreachable') continue;
    seen.add(registrableDomain(source.url) ?? source.url.toLowerCase());
  }
  return seen.size;
}

function sourceCountPoints(independent: number): number {
  if (independent <= 0) return 0;
  if (independent === 1) return 10;
  if (independent === 2) return 22;
  return 30;
}

/**
 * The best tier among the sources, judged by domain rather than by what the
 * model called itself. `source.tier` arrived in the model's JSON and was worth
 * twenty-five points on its own word.
 */
function tierPoints(sources: SourceAssessment[]): number {
  let best = 0;
  for (const source of sources) {
    best = Math.max(best, TIER_POINTS[tierForUrl(source.url)]);
  }
  return best;
}

/**
 * How much confirmed corroboration the app found for itself.
 *
 * `blocked` is not `unreachable`: a bot wall means the app could not read the
 * page, a dead URL means there may be no page. Neither is proof of a fake on
 * its own.
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

  // Nothing resolved at all is the signature of invented citations. One bad
  // deep link among pages that did resolve is a citation error, and it already
  // costs its place in the independent-source count.
  const resolved = sources.filter((s) => s.fetchStatus !== 'unreachable');
  if (resolved.length === 0) return 0;

  const confirmed = countIndependentSources(sources.filter((s) => s.fetchStatus === 'ok'));
  if (confirmed >= 2) return 20;
  if (confirmed === 1) return 12;

  /*
   * The page carries the figures but not the sentence.
   *
   * Worth most of a verbatim hit, because what a fabricated citation cannot do
   * is serve a real page containing the specific numbers, dates and names the
   * verdict rests on. What it does not settle is whether the page frames them
   * the way the model said, so it is not worth all of one.
   */
  const supported = countIndependentSources(sources.filter((s) => s.fetchStatus === 'facts_found'));
  if (supported >= 2) return 16;
  if (supported === 1) return 9;

  /*
   * Nothing matched, but every page was read. Weak evidence, not no evidence:
   * these all served content. Live pages rewrite themselves between the model
   * reading them and the app fetching them minutes later, so a forecast page
   * that has rolled over should not score the same as a fabrication.
   *
   * `blocked` earns nothing even here, because the page was never read at all,
   * and in the browser it cannot be told apart from a dead host.
   */
  if (resolved.every((s) => s.fetchStatus === 'quote_not_found')) return 4;
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
  /*
   * One source is enough when it is the body that keeps the record.
   *
   * The National Weather Service is not a source reporting on the temperature,
   * it is who measures it, and demanding a second independent outlet before
   * believing an NWS observation is the kind of proceduralism that kept
   * blocking correct answers. Corroboration is for claims where the sources are
   * all reporting on something they did not themselves record.
   *
   * The tier comes from the domain now, so "primary" means a .gov host or a
   * governing body the table recognises, not the model's opinion of itself.
   */
  const resolved = input.sources.filter((s) => s.fetchStatus !== 'unreachable');
  const hasPrimary = resolved.some((s) => tierForUrl(s.url) === 'primary');

  if (independent === 0) {
    gates.push('No sources were cited.');
  } else if (independent === 1 && !hasPrimary) {
    gates.push('Only one independent source was cited, and it is not the body that would know.');
  }
  /*
   * Gating on "nothing resolved", not on "something did not".
   *
   * Any single dead link used to block the whole check, and it twice stopped a
   * correct verdict backed by two other sources that did resolve and did say
   * what they were quoted as saying. A model that searched and found real pages
   * is not fabricating; it got one deep link wrong, which the log already shows
   * and which no longer counts toward corroboration either.
   */
  if (input.sources.length > 0 && input.sources.every((s) => s.fetchStatus === 'unreachable')) {
    gates.push('No cited source resolved, which is how invented citations look.');
  }

  // A name the host cannot support. Dressing a blog up as a wire service is the
  // cheapest way to make weak evidence look strong, and it costs nothing to
  // check against a domain the app already recognises.
  const misnamed = input.sources.filter((s) => publisherMismatch(s.url, s.publisher));
  if (misnamed.length > 0) {
    gates.push(
      `A source is credited to ${misnamed[0]!.publisher}, which is not whose site it is on.`,
    );
  }

  /*
   * Gating on "nothing here postdates the claim", not on "something does not".
   *
   * The same shape as the dead-link gate above, and the same mistake: one
   * background page published before the prediction used to block a verdict
   * carried by a decisive article published after it. Citing context is not a
   * defect. What is a defect is a check where everything on offer was already
   * in print when the prediction was made, because none of it can be evidence
   * of what happened since.
   *
   * The score still falls to zero either way - `temporalPoints` pays nothing
   * unless every source lands inside the window - so the mixed case is marked
   * on the log without standing in the way of an answer.
   */
  const statement = new Date(input.statementDate).getTime();
  if (!input.isRetroactive && input.sources.length > 0) {
    const anyAfter = input.sources.some(
      (s) => !s.publishedAt || new Date(s.publishedAt).getTime() >= statement,
    );
    if (!anyAfter) gates.push('Every source predates the prediction.');
  }

  return gates;
}
