/**
 * What one pull-to-refresh actually does.
 *
 * There is no cron and no server: a pull is the only thing that ever spends
 * quota, so the budget, the cadence gate and the quota ceiling all meet here.
 */
import type { Db } from '../data/db';
import { DEFAULT_PULL_BUDGET, planPull } from '../domain/cadence';
import { runCheck, type CheckDeps, type CheckPlan } from './runCheck';
import { VerifierError, type CheckTriggerKind } from './types';
import { cooldownFor, describeCooldown, isCoolingDown, type Cooldown } from './cooldown';
import { parseQuotaFailure } from './quotaError';
import { SETTING_KEYS } from '../data/repositories/settingsRepo';

export interface PullSummary {
  checked: number;
  resolved: number;
  queued: number;
  lateHits: number;
  staledOut: number;
  skipped: number;
  errors: number;
  /** Due, but beyond this pull's budget. */
  deferred: number;
  /** Due, but beyond what today's quota allows. */
  quotaBlocked: number;
  firstError: string | null;
  /** Set when the run stopped because the provider's allowance is spent. */
  cooledDown: Cooldown | null;
  plans: CheckPlan[];
}

export function readCooldown(db: Db): Cooldown | null {
  const stored = db.settings.getJson<Cooldown | null>(SETTING_KEYS.cooldown, null);
  return isCoolingDown(stored) ? stored : null;
}

/** Lifts the hold. Deliberately leaves the strike count alone: overriding a
 *  wait is not evidence that the limit went away. */
export function clearCooldown(db: Db): void {
  db.settings.setJson(SETTING_KEYS.cooldown, null);
}

export interface PullOptions {
  budget?: number;
  /** Spacing between model calls, to stay under the per-minute limit. */
  minGapMs?: number;
  /** null means the provider publishes no cap. */
  dailyQuota?: number | null;
  trigger?: CheckTriggerKind;
  now?: () => Date;
  /** Check exactly this one, bypassing the cadence gate. */
  onlyPredictionId?: string;
}

/** Six seconds apart keeps a pull under a 10-per-minute ceiling. */
export const DEFAULT_MIN_GAP_MS = 6_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function applyCheckPlan(db: Db, plan: CheckPlan): void {
  if (!plan.check && !plan.predictionPatch) return; // nothing happened

  db.driver.transaction(() => {
    if (plan.check) db.checks.create(plan.check);

    if (plan.predictionPatch) db.predictions.update(plan.predictionId, plan.predictionPatch);
    if (plan.freeze) db.predictions.freeze(plan.predictionId);

    for (const update of plan.criteriaUpdates) {
      db.predictions.setCriterionSatisfied(update.id, update.satisfied);
    }

    // 'system' covers work the app did without calling anybody.
    if (plan.check && plan.check.provider !== 'system') db.quota.record(plan.check.provider);
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

  // Refuse to spend an allowance already known to be gone. Every attempt past
  // that point is a guaranteed failure that still costs a request.
  const held = readCooldown(db);
  if (held) {
    return {
      checked: 0, resolved: 0, queued: 0, lateHits: 0, staledOut: 0, skipped: 0,
      errors: 0, deferred: 0, quotaBlocked: toCheck.length, firstError: describeCooldown(held, now),
      cooledDown: held, plans: [],
    };
  }

  const summary: PullSummary = {
    checked: 0,
    resolved: 0,
    queued: 0,
    lateHits: 0,
    staledOut: 0,
    skipped: 0,
    errors: 0,
    deferred,
    quotaBlocked,
    firstError: null,
    cooledDown: null,
    plans: [],
  };

  let first = true;
  for (const prediction of toCheck) {
    // Free tiers cap requests per minute, not just per day. Firing a whole pull
    // back to back trips that cap and turns a working pull into a row of
    // rate-limit errors, so calls are spaced instead.
    if (!first) await sleep(options.minGapMs ?? DEFAULT_MIN_GAP_MS);
    first = false;

    const plan = await runCheck(deps, {
      prediction,
      criteria: db.predictions.criteriaFor(prediction.id),
      priorFindings: db.checks.priorFindings(prediction.id),
      trigger,
    });

    applyCheckPlan(db, plan);
    summary.plans.push(plan);

    if (plan.countsAsChecked) {
      summary.checked += 1;
      // Something got through, so whatever the limit was, it is over.
      db.settings.setJson(SETTING_KEYS.quotaStrikes, 0);
    }
    if (plan.outcome === 'resolved') summary.resolved += 1;
    if (plan.outcome === 'queued') summary.queued += 1;
    if (plan.outcome === 'late_hit') summary.lateHits += 1;
    if (plan.outcome === 'staled_out') summary.staledOut += 1;
    if (plan.outcome === 'skipped') summary.skipped += 1;
    if (plan.outcome === 'error') {
      summary.errors += 1;
      summary.firstError ??= plan.message;

      // A spent allowance ends the pull. Carrying on would burn the rest of
      // the budget on identical failures.
      const cooldown = cooldownFrom(db, plan);
      if (cooldown) {
        db.settings.setJson(SETTING_KEYS.cooldown, cooldown);
        summary.cooledDown = cooldown;
        summary.quotaBlocked += toCheck.length - summary.plans.length;
        break;
      }
    }
  }

  await db.driver.persist();
  return summary;
}

function cooldownFrom(db: Db, plan: CheckPlan): Cooldown | null {
  const error = plan.error;
  if (!(error instanceof VerifierError) || error.kind !== 'rate_limit') return null;

  const failure = error.detail ? parseQuotaFailure(error.detail) : null;
  const scope = failure?.scope ?? 'unknown';

  // Kept outside the cooldown itself, so lifting a hold does not erase what
  // has been learned about the provider. Only a successful check does that.
  const strikes =
    scope === 'unknown' ? db.settings.getJson<number>(SETTING_KEYS.quotaStrikes, 0) + 1 : 1;
  if (scope === 'unknown') db.settings.setJson(SETTING_KEYS.quotaStrikes, strikes);

  return cooldownFor(scope, error.retryAfterSeconds ?? null, new Date(), strikes);
}

/** One line for the pull banner. */
export function describePull(summary: PullSummary): string {
  if (summary.cooledDown) return describeCooldown(summary.cooledDown);
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
