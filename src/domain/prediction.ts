/**
 * Prediction state machine and deadline math. Pure functions over plain objects.
 * Nothing here touches the database, the network, or React.
 */
import type { Iso, Prediction, PredictionStatus, ResolvedBy, Trend } from './types';

export const RESOLVED_STATUSES: readonly PredictionStatus[] = [
  'hit',
  'miss',
  'partial',
  'ambiguous',
  'void',
];

export function isResolved(status: PredictionStatus): boolean {
  return RESOLVED_STATUSES.includes(status);
}

export function isActive(status: PredictionStatus): boolean {
  return status === 'open' || status === 'draft';
}

/**
 * Allowed transitions.
 *
 * draft -> open           confirming the criteria starts the clock
 * open  -> any resolved   the normal path
 * resolved -> open        reopening a verdict the user disagrees with
 * resolved -> resolved    correcting a verdict to a different one
 *
 * A late hit is NOT a transition. The verdict stays `miss` permanently and the
 * prediction gains a `lateHitAt` timestamp instead, because the timeframe was
 * part of the claim.
 */
export function canTransition(from: PredictionStatus, to: PredictionStatus): boolean {
  if (from === to) return false;
  if (from === 'draft') return to === 'open';
  if (from === 'open') return isResolved(to);
  if (isResolved(from)) return to === 'open' || isResolved(to);
  return false;
}

export class InvalidTransitionError extends Error {
  constructor(from: PredictionStatus, to: PredictionStatus) {
    super(`Cannot move a prediction from "${from}" to "${to}"`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * The single instant this prediction is measured against, used for countdowns,
 * notification scheduling, and cadence math.
 *
 * Event-triggered predictions have no true deadline, so we fall back to the
 * expected date (a cadence hint only) and then to the stale-out date.
 */
export function effectiveDeadline(p: Prediction): Iso | null {
  switch (p.deadlineType) {
    case 'fixed_date':
      return p.resolutionDate;
    case 'window':
      return p.windowEnd;
    case 'event':
      return p.triggerExpectedDate ?? p.staleOutDate;
  }
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `now` until the effective deadline. Negative once overdue. */
export function daysUntilDeadline(p: Prediction, now: Date = new Date()): number | null {
  const deadline = effectiveDeadline(p);
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - now.getTime()) / MS_PER_DAY);
}

export function isPastDeadline(p: Prediction, now: Date = new Date()): boolean {
  const deadline = effectiveDeadline(p);
  if (!deadline) return false;
  return new Date(deadline).getTime() < now.getTime();
}

/**
 * Is `at` inside the period the claim covers? A window hit anywhere between
 * start and end counts as on time; a fixed date only counts up to the deadline.
 */
export function isWithinClaimPeriod(p: Prediction, at: Date): boolean {
  const t = at.getTime();
  switch (p.deadlineType) {
    case 'fixed_date':
      return p.resolutionDate ? t <= new Date(p.resolutionDate).getTime() : true;
    case 'window': {
      const start = p.windowStart ? new Date(p.windowStart).getTime() : -Infinity;
      const end = p.windowEnd ? new Date(p.windowEnd).getTime() : Infinity;
      return t >= start && t <= end;
    }
    case 'event':
      return p.staleOutDate ? t <= new Date(p.staleOutDate).getTime() : true;
  }
}

/** An event or race prediction that has run out its rope resolves `void`. */
export function shouldStaleOut(p: Prediction, now: Date = new Date()): boolean {
  if (p.status !== 'open') return false;
  if (p.deadlineType !== 'event') return false;
  if (!p.staleOutDate) return false;
  return new Date(p.staleOutDate).getTime() <= now.getTime();
}

export type LateWatchPeriod = 'never' | '1y' | '3y' | 'forever';

export const DEFAULT_LATE_WATCH: LateWatchPeriod = '3y';

/**
 * How long we keep looking after a miss. The verdict never changes, but a late
 * occurrence earns a "Better Late Than Never" badge.
 */
export function lateWatchUntil(deadline: Iso, period: LateWatchPeriod): Iso | null {
  if (period === 'never') return null;
  if (period === 'forever') return '9999-12-31T23:59:59.999Z';
  const d = new Date(deadline);
  d.setUTCFullYear(d.getUTCFullYear() + (period === '1y' ? 1 : 3));
  return d.toISOString();
}

export function isUnderLateWatch(p: Prediction, now: Date = new Date()): boolean {
  if (p.status !== 'miss') return false;
  if (p.lateHitAt) return false;
  if (!p.lateWatchUntil) return false;
  return new Date(p.lateWatchUntil).getTime() > now.getTime();
}

/** Months between the deadline and a late occurrence, for the badge copy. */
export function lateByMonths(p: Prediction): number | null {
  const deadline = effectiveDeadline(p);
  if (!deadline || !p.lateHitAt) return null;
  const from = new Date(deadline);
  const to = new Date(p.lateHitAt);
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(0, months);
}

export type PredictionPatch = Partial<Prediction> & { updatedAt: Iso };

/** Resolve a prediction. Throws if the transition is not legal. */
export function resolve(
  p: Prediction,
  verdict: PredictionStatus,
  by: ResolvedBy,
  now: Date = new Date(),
  opts: { confidenceScore?: number; lateWatch?: LateWatchPeriod } = {},
): PredictionPatch {
  if (!isResolved(verdict)) throw new InvalidTransitionError(p.status, verdict);
  if (!canTransition(p.status, verdict)) throw new InvalidTransitionError(p.status, verdict);

  const iso = now.toISOString();
  const patch: PredictionPatch = {
    status: verdict,
    resolvedAt: iso,
    resolvedBy: by,
    trend: null,
    confidenceScore: opts.confidenceScore ?? null,
    updatedAt: iso,
  };

  if (verdict === 'miss') {
    const deadline = effectiveDeadline(p);
    patch.lateWatchUntil = deadline
      ? lateWatchUntil(deadline, opts.lateWatch ?? DEFAULT_LATE_WATCH)
      : null;
  } else {
    patch.lateWatchUntil = null;
  }

  return patch;
}

/** Reopen a resolved prediction. Always recorded as a user override. */
export function reopen(p: Prediction, now: Date = new Date()): PredictionPatch {
  if (!canTransition(p.status, 'open')) throw new InvalidTransitionError(p.status, 'open');
  const iso = now.toISOString();
  return {
    status: 'open',
    resolvedAt: null,
    resolvedBy: 'user_override',
    confidenceScore: null,
    lateWatchUntil: null,
    trend: 'unknown',
    updatedAt: iso,
  };
}

/** Confirming the criteria moves a draft to open and starts the clock. */
export function confirmDraft(p: Prediction, now: Date = new Date()): PredictionPatch {
  if (!canTransition(p.status, 'open')) throw new InvalidTransitionError(p.status, 'open');
  const iso = now.toISOString();
  return { status: 'open', trend: 'unknown', updatedAt: iso };
}

/**
 * The event happened, just late. The verdict stays `miss` on purpose.
 */
export function markLateHit(p: Prediction, occurredAt: Iso, now: Date = new Date()): PredictionPatch {
  if (p.status !== 'miss') {
    throw new Error('Only a miss can become a late hit');
  }
  return { lateHitAt: occurredAt, updatedAt: now.toISOString() };
}

export function setTrend(p: Prediction, trend: Trend, now: Date = new Date()): PredictionPatch {
  if (p.status !== 'open') throw new Error('Only an open prediction has a trend');
  return { trend, updatedAt: now.toISOString() };
}

/**
 * A date-only deadline ("by Halloween") means the end of that day in the
 * user's local timezone, stored as UTC.
 */
export function endOfLocalDay(dateOnly: string): Iso {
  const parts = dateOnly.split('-').map(Number);
  const [y, m, d] = [parts[0] ?? 1970, parts[1] ?? 1, parts[2] ?? 1];
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

export function startOfLocalDay(dateOnly: string): Iso {
  const parts = dateOnly.split('-').map(Number);
  const [y, m, d] = [parts[0] ?? 1970, parts[1] ?? 1, parts[2] ?? 1];
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** Inverse of endOfLocalDay / startOfLocalDay, for populating date inputs. */
export function toLocalDateInput(iso: Iso): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
