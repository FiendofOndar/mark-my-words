/**
 * What one pull-to-refresh actually does.
 *
 * There is no cron and no server: a pull is the only thing that ever spends
 * quota, so the budget, the cadence gate and the quota ceiling all meet here.
 */
import type { Db } from '../data/db';
import { DEFAULT_PULL_BUDGET, planPull } from '../domain/cadence';
import { runCheck, type CheckDeps, type CheckPlan } from './runCheck';
import type { CheckTriggerKind } from './types';

export interface PullSummary {
  checked: number;
  resolved: number;
  queued: number;
  lateHits: number;
  staledOut: number;
  errors: number;
  /** Due, but beyond this pull's budget. */
  deferred: number;
  /** Due, but beyond what today's quota allows. */
  quotaBlocked: number;
  firstError: string | null;
  plans: CheckPlan[];
}

export interface PullOptions {
  budget?: number;
  /** null means the provider publishes no cap. */
  dailyQuota?: number | null;
  trigger?: CheckTriggerKind;
  now?: () => Date;
  /** Check exactly this one, bypassing the cadence gate. */
  onlyPredictionId?: string;
}

export function applyCheckPlan(db: Db, plan: CheckPlan): void {
  db.driver.transaction(() => {
    db.checks.create(plan.check);

    if (plan.predictionPatch) db.predictions.update(plan.predictionId, plan.predictionPatch);
    if (plan.freeze) db.predictions.freeze(plan.predictionId);

    for (const update of plan.criteriaUpdates) {
      db.predictions.setCriterionSatisfied(update.id, update.satisfied);
    }

    if (plan.check.provider !== 'system') db.quota.record(plan.check.provider);
  });
}

export async function runPull(
  db: Db,
  deps: CheckDeps,
  options: PullOptions = {},
): Promise<PullSummary> {
  const now = options.now?.() ?? new Date();
  const trigger: CheckTriggerKind = options.trigger ?? 'pull';

  const all = db.predictions.list();

  let toCheck: typeof all;
  let deferred = 0;

  if (options.onlyPredictionId) {
    toCheck = all.filter((p) => p.id === options.onlyPredictionId);
  } else {
    const plan = planPull(all, now, options.budget ?? DEFAULT_PULL_BUDGET);
    toCheck = plan.toCheck;
    deferred = plan.deferred.length;
  }

  // The quota ceiling trims the plan rather than failing mid-pull, so the user
  // is told what was left undone instead of discovering it later.
  let quotaBlocked = 0;
  if (options.dailyQuota != null) {
    const remaining = Math.max(0, options.dailyQuota - db.quota.usedToday(deps.verifier.providerId, now));
    if (toCheck.length > remaining) {
      quotaBlocked = toCheck.length - remaining;
      toCheck = toCheck.slice(0, remaining);
    }
  }

  const summary: PullSummary = {
    checked: 0,
    resolved: 0,
    queued: 0,
    lateHits: 0,
    staledOut: 0,
    errors: 0,
    deferred,
    quotaBlocked,
    firstError: null,
    plans: [],
  };

  for (const prediction of toCheck) {
    const plan = await runCheck(deps, {
      prediction,
      criteria: db.predictions.criteriaFor(prediction.id),
      priorFindings: db.checks.priorFindings(prediction.id),
      trigger,
    });

    applyCheckPlan(db, plan);
    summary.plans.push(plan);

    if (plan.countsAsChecked) summary.checked += 1;
    if (plan.outcome === 'resolved') summary.resolved += 1;
    if (plan.outcome === 'queued') summary.queued += 1;
    if (plan.outcome === 'late_hit') summary.lateHits += 1;
    if (plan.outcome === 'staled_out') summary.staledOut += 1;
    if (plan.outcome === 'error') {
      summary.errors += 1;
      summary.firstError ??= plan.message;
    }
  }

  await db.driver.persist();
  return summary;
}

/** One line for the pull banner. */
export function describePull(summary: PullSummary): string {
  if (summary.firstError && summary.checked === 0) return summary.firstError;

  const parts: string[] = [];
  if (summary.resolved > 0) parts.push(`${summary.resolved} resolved`);
  if (summary.queued > 0) parts.push(`${summary.queued} waiting on you`);
  if (summary.lateHits > 0) parts.push(`${summary.lateHits} late hit${summary.lateHits === 1 ? '' : 's'}`);
  if (summary.staledOut > 0) parts.push(`${summary.staledOut} voided`);
  if (parts.length === 0) {
    parts.push(summary.checked === 0 ? 'Nothing was due' : `${summary.checked} checked, nothing new`);
  }

  if (summary.deferred > 0) parts.push(`${summary.deferred} deferred`);
  if (summary.quotaBlocked > 0) parts.push(`${summary.quotaBlocked} over today's quota`);
  if (summary.errors > 0) parts.push(`${summary.errors} failed`);

  return parts.join(' · ');
}
