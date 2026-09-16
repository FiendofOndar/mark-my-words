/**
 * Which open predictions are due for a verification check, and which ones a
 * single pull-to-refresh is allowed to spend quota on.
 *
 * There is no cron and no server. A pull is the only trigger, so this gate is
 * the whole scheduling system.
 */
import type { Prediction } from './types';
import { daysUntilDeadline, effectiveDeadline, isUnderLateWatch } from './prediction';

const HOURS = 3_600_000;
const DAYS = 86_400_000;

/** Minimum gap between checks once a prediction is inside its final week. */
export const MIN_GAP_MS = 12 * HOURS;

export interface DueResult {
  due: boolean;
  /** Days between checks at this stage. null when the prediction never checks. */
  intervalDays: number | null;
  reason: string;
}

const NOT_DUE = (reason: string): DueResult => ({ due: false, intervalDays: null, reason });

export function checkIntervalDays(p: Prediction, now: Date = new Date()): number | null {
  if (isUnderLateWatch(p, now)) return 30;
  if (p.status !== 'open') return null;

  const days = daysUntilDeadline(p, now);

  // An event prediction with no expected date has nothing to count down to.
  if (days === null) return 30;

  if (days > 180) return 30;
  if (days > 30) return 14;
  if (days > 7) return 7;
  return 0; // every pull, subject to MIN_GAP_MS
}

export function isDueForCheck(p: Prediction, now: Date = new Date()): DueResult {
  if (p.status === 'draft') return NOT_DUE('Draft, criteria not confirmed');
  if (p.verificationMode === 'manual') return NOT_DUE('Resolved by you, not by search');
  if (p.deletedAt) return NOT_DUE('Deleted');

  const underLateWatch = isUnderLateWatch(p, now);
  if (p.status !== 'open' && !underLateWatch) return NOT_DUE('Already resolved');

  if (p.noCheckBefore && new Date(p.noCheckBefore).getTime() > now.getTime()) {
    return NOT_DUE('Too early to resolve');
  }

  const intervalDays = checkIntervalDays(p, now);
  if (intervalDays === null) return NOT_DUE('No check cadence');

  if (!p.lastCheckedAt) {
    return { due: true, intervalDays, reason: 'Never checked' };
  }

  const since = now.getTime() - new Date(p.lastCheckedAt).getTime();

  if (intervalDays === 0) {
    return since >= MIN_GAP_MS
      ? { due: true, intervalDays, reason: 'Deadline is close' }
      : { due: false, intervalDays, reason: 'Checked within the last 12 hours' };
  }

  return since >= intervalDays * DAYS
    ? { due: true, intervalDays, reason: `Last checked over ${intervalDays} days ago` }
    : { due: false, intervalDays, reason: `Checked within the last ${intervalDays} days` };
}

/**
 * Priority tiers for spending a limited per-pull budget.
 * Lower number wins.
 */
export function checkPriority(p: Prediction, now: Date = new Date()): number {
  const days = daysUntilDeadline(p, now);
  if (p.status === 'open' && days !== null && days < 0) return 1; // overdue, unresolved
  if (days !== null && days <= 7) return 2;
  if (p.lastCheckedAt) return 3; // ordered by staleness below
  return 4; // never checked
}

export interface PullPlan {
  toCheck: Prediction[];
  deferred: Prediction[];
  skipped: number;
}

/**
 * Checks are spaced to respect a per-minute rate limit, so this is also a
 * ceiling on how long a pull takes. Six is about thirty-five seconds.
 */
export const DEFAULT_PULL_BUDGET = 6;

/**
 * Decide what a single pull actually spends quota on.
 * Anything due beyond the budget is deferred, never silently dropped.
 */
export function planPull(
  predictions: Prediction[],
  now: Date = new Date(),
  budget: number = DEFAULT_PULL_BUDGET,
): PullPlan {
  const due = predictions.filter((p) => isDueForCheck(p, now).due);
  const skipped = predictions.length - due.length;

  due.sort((a, b) => {
    const pa = checkPriority(a, now);
    const pb = checkPriority(b, now);
    if (pa !== pb) return pa - pb;

    // Within a tier, the stalest goes first. Never-checked counts as maximally stale.
    const sa = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0;
    const sb = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0;
    if (sa !== sb) return sa - sb;

    const da = effectiveDeadline(a);
    const db = effectiveDeadline(b);
    const byDeadline = (da ? new Date(da).getTime() : Infinity) - (db ? new Date(db).getTime() : Infinity);
    if (byDeadline !== 0 && !Number.isNaN(byDeadline)) return byDeadline;

    // Two claims "by the end of the year" share a deadline to the
    // millisecond, and if neither has been checked the whole comparison
    // ties. Without a last word, which one got the budget was whichever
    // row the database returned first. Same fix as the feed's.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    toCheck: due.slice(0, budget),
    deferred: due.slice(budget),
    skipped,
  };
}
