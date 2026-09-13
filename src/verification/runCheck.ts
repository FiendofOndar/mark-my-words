/**
 * One verification pass over one prediction.
 *
 * The IO happens here (model call, source fetches) but nothing is written.
 * A plan comes back describing every change, which keeps the decision logic
 * testable without a database and makes an interrupted pull a no-op rather
 * than a half-written record.
 */
import type { CriteriaElement, Prediction } from '../domain/types';
import {
  describeDeadline,
} from '../domain/format';
import {
  isResolved,
  isUnderLateWatch,
  markLateHit,
  resolve,
  shouldStaleOut,
  toLocalDateInput,
  type PredictionPatch,
} from '../domain/prediction';
import { assessCheck, type Assessment } from '../domain/gates';
import { validateSources, type PageFetcher, type ValidatedSource } from './validateSources';
import { VerifierError, type CheckInput, type CheckTriggerKind, type Verifier } from './types';
import type { NewCheck } from '../data/repositories/checkRepo';

export type CheckPlanOutcome =
  | 'resolved'
  | 'late_hit'
  | 'queued'
  | 'no_change'
  | 'staled_out'
  | 'skipped'
  | 'error';

export interface CheckPlan {
  predictionId: string;
  outcome: CheckPlanOutcome;
  /** One line for the pull summary. */
  message: string;
  /** Absent when nothing was done, so the check log is not padded with non-events. */
  check: NewCheck | null;
  predictionPatch: PredictionPatch | null;
  criteriaUpdates: { id: string; satisfied: boolean | null }[];
  /** True on the first successful check, which seals the criteria. */
  freeze: boolean;
  /** False for an error, so the prediction stays due for the next pull. */
  countsAsChecked: boolean;
  assessment: Assessment | null;
  sources: ValidatedSource[];
  /** Present on a failure, so callers can react to why rather than to text. */
  error?: Error;
}

export interface CheckDeps {
  verifier: Verifier;
  fetcher: PageFetcher;
  now?: () => Date;
}

export interface CheckContext {
  prediction: Prediction;
  criteria: CriteriaElement[];
  priorFindings: string | null;
  trigger: CheckTriggerKind;
}

export async function runCheck(deps: CheckDeps, ctx: CheckContext): Promise<CheckPlan> {
  const now = deps.now?.() ?? new Date();
  const p = ctx.prediction;

  if (shouldStaleOut(p, now)) return staleOutPlan(p, now, ctx.trigger);

  // Force-checking is allowed to bypass the cadence gate, but not the fact that
  // a settled prediction has nothing left to decide. Without this, a model that
  // confirms a verdict the prediction already carries throws on the transition
  // and takes the whole pull down with it.
  if (isResolved(p.status) && !isUnderLateWatch(p, now)) {
    return skippedPlan(p, 'Already settled.');
  }
  if (p.status === 'draft') return skippedPlan(p, 'Still a draft, so the clock has not started.');

  const input: CheckInput = {
    claim: p.normalizedClaim,
    polarity: p.polarity,
    disconfirmingTrigger: p.disconfirmingTrigger,
    criteriaElements: ctx.criteria.map((c) => c.text),
    statementDate: toLocalDateInput(p.statementDate),
    deadlineDescription: describeDeadline(p),
    raceEventB: p.raceEventB,
    suggestedQueries: p.searchQueries,
    priorFindings: ctx.priorFindings,
    // Local, not UTC. `deadlineDescription` is formatted in local time, so a
    // UTC "today" put the two a day apart for everyone west of Greenwich for
    // the last hours of every day: in Pacific, any check after 5pm told the
    // model it was already tomorrow. On a claim about one specific day that is
    // the difference between "not yet" and a verdict.
    today: toLocalDateInput(now.toISOString()),
  };

  let result;
  try {
    result = await deps.verifier.check(input);
  } catch (err) {
    return errorPlan(p, ctx.trigger, deps.verifier, err as Error);
  }

  const sources = await validateSources(result.sources, deps.fetcher);

  const assessment = assessCheck({
    sources,
    modelConfidence: result.modelConfidence,
    statementDate: p.statementDate,
    proposedVerdict: result.verdict,
    forceManual: p.forceManual,
    isRetroactive: p.isRetroactive,
  });

  const criteriaUpdates = result.criteriaStatus.flatMap((status) => {
    const element = ctx.criteria[status.index];
    return element ? [{ id: element.id, satisfied: status.satisfied }] : [];
  });

  const base = {
    predictionId: p.id,
    criteriaUpdates,
    freeze: p.criteriaFrozenAt === null,
    countsAsChecked: true,
    assessment,
    sources,
  };

  const checkRow = (outcome: NewCheck['outcome']): NewCheck => ({
    predictionId: p.id,
    trigger: ctx.trigger,
    provider: result.provider,
    model: result.model,
    proposedVerdict: result.verdict,
    proposedTrend: result.trend,
    gates: assessment.gates,
    modelConfidence: result.modelConfidence,
    summary: result.summary,
    outcome,
    tokensUsed: result.tokensUsed,
    searchQueries: result.searchQueries ?? null,
    evidence: sources.map((s) => ({
      url: s.url,
      title: s.title,
      publisher: s.publisher,
      publishedAt: s.publishedAt,
      quotedText: s.quotedText,
      tier: s.tier,
      fetchStatus: s.fetchStatus,
      fetchedAt: s.fetchedAt,
    })),
  });

  // Nothing decisive. Record the finding and move the trend.
  if (result.verdict === 'no_change') {
    return {
      ...base,
      outcome: 'no_change',
      message: 'Nothing yet',
      check: checkRow('no_change'),
      predictionPatch: {
        trend: p.status === 'open' ? result.trend : p.trend,
        lastCheckedAt: now.toISOString(),
        checkCount: p.checkCount + 1,
        updatedAt: now.toISOString(),
      },
    };
  }

  // A miss that came true later keeps its verdict and earns the badge instead.
  //
  // Anything else under late watch is the model confirming a verdict the
  // prediction already carries, and there is nothing to apply. This used to
  // fall through to `resolve`, which refuses a miss-to-miss transition and
  // threw out of the whole pull. Every miss got a three-year watch by default,
  // so every miss became that thirty days after it settled.
  if (isUnderLateWatch(p, now) && result.verdict !== 'hit') {
    return {
      ...base,
      outcome: 'no_change',
      message: 'Still a miss',
      check: checkRow('no_change'),
      predictionPatch: {
        lastCheckedAt: now.toISOString(),
        checkCount: p.checkCount + 1,
        updatedAt: now.toISOString(),
      },
    };
  }
  if (isUnderLateWatch(p, now) && result.verdict === 'hit') {
    if (assessment.decision === 'auto_resolve') {
      return {
        ...base,
        outcome: 'late_hit',
        message: 'It happened, late',
        check: checkRow('auto_resolved'),
        predictionPatch: {
          ...markLateHit(p, occurrenceDate(sources, now), now),
          lastCheckedAt: now.toISOString(),
          checkCount: p.checkCount + 1,
        },
      };
    }
    return {
      ...base,
      outcome: 'queued',
      message: 'Possible late hit, needs you',
      check: checkRow('queued'),
      predictionPatch: {
        lastCheckedAt: now.toISOString(),
        checkCount: p.checkCount + 1,
        updatedAt: now.toISOString(),
      },
    };
  }

  if (assessment.decision === 'auto_resolve') {
    return {
      ...base,
      outcome: 'resolved',
      message: `Resolved ${result.verdict}`,
      check: checkRow('auto_resolved'),
      predictionPatch: {
        ...resolve(p, result.verdict, 'auto', now),
        lastCheckedAt: now.toISOString(),
        checkCount: p.checkCount + 1,
      },
    };
  }

  if (assessment.decision === 'queue') {
    return {
      ...base,
      outcome: 'queued',
      message: 'Verdict ready for you',
      check: checkRow('queued'),
      predictionPatch: {
        trend: p.status === 'open' ? result.trend : p.trend,
        lastCheckedAt: now.toISOString(),
        checkCount: p.checkCount + 1,
        updatedAt: now.toISOString(),
      },
    };
  }

  // Unreachable: a verdict other than no_change is always applied or queued.
  throw new Error(`Unhandled decision "${assessment.decision}" for verdict "${result.verdict}"`);
}

/** The earliest validated source date is the best evidence of when it happened. */
function occurrenceDate(sources: ValidatedSource[], now: Date): string {
  const dates = sources
    .filter((s) => s.fetchStatus === 'ok' || s.fetchStatus === 'blocked')
    .map((s) => s.publishedAt)
    .filter((d): d is string => d !== null)
    .sort();
  return dates[0] ? new Date(`${dates[0]}T12:00:00.000Z`).toISOString() : now.toISOString();
}

function skippedPlan(p: Prediction, message: string): CheckPlan {
  return {
    predictionId: p.id,
    outcome: 'skipped',
    message,
    check: null,
    predictionPatch: null,
    criteriaUpdates: [],
    freeze: false,
    countsAsChecked: false,
    assessment: null,
    sources: [],
  };
}

function staleOutPlan(p: Prediction, now: Date, trigger: CheckTriggerKind): CheckPlan {
  return {
    predictionId: p.id,
    outcome: 'staled_out',
    message: 'Gave up waiting',
    freeze: false,
    countsAsChecked: true,
    assessment: null,
    sources: [],
    criteriaUpdates: [],
    check: {
      predictionId: p.id,
      trigger,
      provider: 'system',
      model: null,
      proposedVerdict: 'void',
      proposedTrend: null,
      gates: null,
      modelConfidence: null,
      summary: 'Passed its stale-out date without resolving, so it was voided.',
      outcome: 'auto_resolved',
    },
    predictionPatch: {
      ...resolve(p, 'void', 'auto', now),
      lastCheckedAt: now.toISOString(),
      checkCount: p.checkCount + 1,
    },
  };
}

export function errorPlan(
  p: Prediction,
  trigger: CheckTriggerKind,
  verifier: Verifier,
  err: Error,
): CheckPlan {
  const detail = err instanceof VerifierError ? err.detail : undefined;
  return {
    predictionId: p.id,
    outcome: 'error',
    message: err.message,
    freeze: false,
    // An error must not consume the cadence slot, or a broken key would quietly
    // push every prediction a full interval into the future.
    countsAsChecked: false,
    assessment: null,
    sources: [],
    criteriaUpdates: [],
    predictionPatch: null,
    error: err,
    check: {
      predictionId: p.id,
      trigger,
      provider: verifier.providerId,
      model: verifier.modelId,
      proposedVerdict: null,
      proposedTrend: null,
      gates: null,
      modelConfidence: null,
      summary: err.message,
      outcome: 'error',
      // The raw provider response, so a failure can be diagnosed from the log
      // rather than reproduced.
      errorMessage: detail ?? err.message,
    },
  };
}
