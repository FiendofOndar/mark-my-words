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
  effectiveDeadline,
  isUnderLateWatch,
  markLateHit,
  resolve,
  shouldStaleOut,
  type PredictionPatch,
} from '../domain/prediction';
import { scoreCheck, type RubricResult } from '../domain/rubric';
import { coverageFrom } from './checkSchema';
import { validateSources, type PageFetcher, type ValidatedSource } from './validateSources';
import { VerifierError, type CheckInput, type CheckTriggerKind, type Verifier } from './types';
import type { NewCheck } from '../data/repositories/checkRepo';

export type CheckPlanOutcome =
  | 'resolved'
  | 'late_hit'
  | 'queued'
  | 'no_change'
  | 'staled_out'
  | 'error';

export interface CheckPlan {
  predictionId: string;
  outcome: CheckPlanOutcome;
  /** One line for the pull summary. */
  message: string;
  check: NewCheck;
  predictionPatch: PredictionPatch | null;
  criteriaUpdates: { id: string; satisfied: boolean | null }[];
  /** True on the first successful check, which seals the criteria. */
  freeze: boolean;
  /** False for an error, so the prediction stays due for the next pull. */
  countsAsChecked: boolean;
  rubric: RubricResult | null;
  sources: ValidatedSource[];
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

  const input: CheckInput = {
    claim: p.normalizedClaim,
    polarity: p.polarity,
    disconfirmingTrigger: p.disconfirmingTrigger,
    criteriaElements: ctx.criteria.map((c) => c.text),
    statementDate: p.statementDate.slice(0, 10),
    deadlineDescription: describeDeadline(p),
    raceEventB: p.raceEventB,
    suggestedQueries: p.searchQueries,
    priorFindings: ctx.priorFindings,
    today: now.toISOString().slice(0, 10),
  };

  let result;
  try {
    result = await deps.verifier.check(input);
  } catch (err) {
    return errorPlan(p, ctx.trigger, deps.verifier, err as Error);
  }

  const sources = await validateSources(result.sources, deps.fetcher);

  const rubric = scoreCheck({
    sources,
    coverage: coverageFrom(result.criteriaStatus, ctx.criteria.length),
    modelConfidence: result.modelConfidence,
    statementDate: p.statementDate,
    // A late-watch check is looking for evidence that by definition postdates
    // the deadline, so it gets no upper bound. Sources must still postdate the
    // prediction itself.
    claimPeriodEnd: isUnderLateWatch(p, now) ? null : effectiveDeadline(p),
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
    rubric,
    sources,
  };

  const checkRow = (outcome: NewCheck['outcome']): NewCheck => ({
    predictionId: p.id,
    trigger: ctx.trigger,
    provider: result.provider,
    model: result.model,
    proposedVerdict: result.verdict,
    proposedTrend: result.trend,
    rubricScore: rubric.score,
    rubricBreakdown: { ...rubric.breakdown, gates: rubric.gates },
    modelConfidence: result.modelConfidence,
    summary: result.summary,
    outcome,
    tokensUsed: result.tokensUsed,
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
  if (isUnderLateWatch(p, now) && result.verdict === 'hit') {
    if (rubric.decision === 'auto_resolve') {
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

  if (rubric.decision === 'auto_resolve') {
    return {
      ...base,
      outcome: 'resolved',
      message: `Resolved ${result.verdict}`,
      check: checkRow('auto_resolved'),
      predictionPatch: {
        ...resolve(p, result.verdict, 'auto', now, { confidenceScore: rubric.score }),
        lastCheckedAt: now.toISOString(),
        checkCount: p.checkCount + 1,
      },
    };
  }

  if (rubric.decision === 'queue') {
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

  return {
    ...base,
    outcome: 'no_change',
    message: 'Evidence too thin',
    check: checkRow('no_change'),
    predictionPatch: {
      trend: p.status === 'open' ? result.trend : p.trend,
      lastCheckedAt: now.toISOString(),
      checkCount: p.checkCount + 1,
      updatedAt: now.toISOString(),
    },
  };
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

function staleOutPlan(p: Prediction, now: Date, trigger: CheckTriggerKind): CheckPlan {
  return {
    predictionId: p.id,
    outcome: 'staled_out',
    message: 'Gave up waiting',
    freeze: false,
    countsAsChecked: true,
    rubric: null,
    sources: [],
    criteriaUpdates: [],
    check: {
      predictionId: p.id,
      trigger,
      provider: 'system',
      model: null,
      proposedVerdict: 'void',
      proposedTrend: null,
      rubricScore: null,
      rubricBreakdown: null,
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

function errorPlan(
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
    rubric: null,
    sources: [],
    criteriaUpdates: [],
    predictionPatch: null,
    check: {
      predictionId: p.id,
      trigger,
      provider: verifier.providerId,
      model: verifier.modelId,
      proposedVerdict: null,
      proposedTrend: null,
      rubricScore: null,
      rubricBreakdown: null,
      modelConfidence: null,
      summary: err.message,
      outcome: 'error',
      errorMessage: detail ?? err.message,
    },
  };
}
