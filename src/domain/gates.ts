/**
 * Deciding what happens to a verification result.
 *
 * The verdict decides. The app's job is to notice when something about the
 * citations is wrong enough that a person should look before the record
 * changes, and to notice when the model itself says it is unsure. Those are
 * the gates. There used to be a 0-100 evidence score alongside them, computed
 * from the same inputs, and it decided nothing: it was information on the
 * check log, and two of the numbers it printed were wrong for structural
 * reasons on correct verdicts. A figure a screen has to disclaim is a figure
 * to remove, so it is gone and the gates are what is left.
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

export interface AssessmentInput {
  sources: SourceAssessment[];
  /** 0-100, as the model reported it. */
  modelConfidence: number | null;
  /** ISO instant the prediction was made. */
  statementDate: string;
  proposedVerdict: PredictionStatus | 'no_change';
  forceManual: boolean;
  isRetroactive: boolean;
}

export interface Assessment {
  /** Reasons this result may not auto-resolve. Empty means nothing was noticed. */
  gates: string[];
  decision: 'auto_resolve' | 'queue' | 'hold';
}

/**
 * Below this the model is telling you it is torn, and the prompt's own anchors
 * say so: 70-89 is "the verdict is right as far as you can tell", 40-69 is
 * "genuinely torn". Being told the answer is uncertain is a reason to ask a
 * person, which is the one place self-reported confidence is worth acting on.
 */
export const CONFIDENT_AT = 70;

/**
 * Two articles from the same outlet are one source, not two.
 *
 * Keyed on the domain, not on the publisher name. The name is a field in the
 * model's own JSON, so two pages on one site labelled "AP" and "Reuters"
 * counted as two independent sources. The domain is the part of a citation
 * that cannot be typed into existence.
 */
export function countIndependentSources(sources: SourceAssessment[]): number {
  const seen = new Set<string>();
  for (const source of sources) {
    // A page that does not exist corroborates nothing.
    if (source.fetchStatus === 'unreachable') continue;
    seen.add(registrableDomain(source.url) ?? source.url.toLowerCase());
  }
  return seen.size;
}

export function assessCheck(input: AssessmentInput): Assessment {
  const gates = collectGates(input);

  /*
   * `hold` is only for a check that resolved nothing. A verdict the app cannot
   * act on is still a verdict somebody should see, so anything else is either
   * applied or queued for the person, never buried.
   */
  const unsure = input.modelConfidence !== null && input.modelConfidence < CONFIDENT_AT;
  const decision =
    input.proposedVerdict === 'no_change'
      ? 'hold'
      : gates.length > 0 || unsure
        ? 'queue'
        : 'auto_resolve';

  return { gates, decision };
}

/**
 * Reasons a result may never auto-resolve.
 *
 * A gate fires on "nothing here works", never on "one thing does not". That
 * shape has been wrong three times: any single dead link gated the check, any
 * single stale quote gated it, and any single source older than the
 * prediction gated it. Each time a correct verdict carried by the other
 * sources was blocked by one bad citation among them.
 */
function collectGates(input: AssessmentInput): string[] {
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
   * believing an NWS observation kept blocking correct answers. Corroboration
   * is for claims where the sources are all reporting on something they did
   * not themselves record. The tier comes from the domain, so "primary" means
   * a .gov host or a governing body the table recognises.
   */
  const independent = countIndependentSources(input.sources);
  const resolved = input.sources.filter((s) => s.fetchStatus !== 'unreachable');
  const hasPrimary = resolved.some((s) => tierForUrl(s.url) === 'primary');

  if (independent === 0) {
    gates.push('No sources were cited.');
  } else if (independent === 1 && !hasPrimary) {
    gates.push('Only one independent source was cited, and it is not the body that would know.');
  }

  // Fabrication looks like nothing resolving, not like something failing. A
  // model that found real pages is not inventing citations; it got one deep
  // link wrong, which the log shows and which no longer counts as corroboration.
  if (input.sources.length > 0 && input.sources.every((s) => s.fetchStatus === 'unreachable')) {
    gates.push('No cited source resolved, which is how invented citations look.');
  }

  /*
   * A name the host cannot support, and the same rule as the dead links: the
   * gate fires when nothing else stands, not when one thing does not.
   *
   * This used to fire on any single mislabelled citation. The one time it
   * fired for real, the model had cited a YouTube page as ESPN beside two
   * confirmed pages on mlb.com and Wikipedia, and a correct verdict carried by
   * those two was held for the label on the third. The label cannot make weak
   * evidence look strong any more, since the tier and the independence count
   * both come from the domain; what it can still do is mislead the person
   * reading the row, and the row now says so beside it.
   */
  const misnamed = input.sources.filter((s) => publisherMismatch(s.url, s.publisher));
  const cleanAndReachable = resolved.filter((s) => !publisherMismatch(s.url, s.publisher));
  if (misnamed.length > 0 && cleanAndReachable.length === 0) {
    gates.push(
      `A source is credited to ${misnamed[0]!.publisher}, which is not whose site it is on, and nothing else stands.`,
    );
  }

  // Gating on "nothing here postdates the claim", not on "something does not".
  // Citing background alongside the decisive article is not a defect. A check
  // where everything on offer was already in print when the prediction was
  // made is, because none of it can be evidence of what happened since.
  const statement = new Date(input.statementDate).getTime();
  if (!input.isRetroactive && input.sources.length > 0) {
    const anyAfter = input.sources.some(
      (s) => !s.publishedAt || new Date(s.publishedAt).getTime() >= statement,
    );
    if (!anyAfter) gates.push('Every source predates the prediction.');
  }

  return gates;
}
