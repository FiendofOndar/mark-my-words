import type { Prediction, PredictionStatus } from './types';
import { daysUntilDeadline, effectiveDeadline, lateByMonths } from './prediction';

/**
 * Display only. The stored status values stay `hit` / `miss` / etc., because
 * they are also the model's JSON contract and the schema's column values.
 */
export const STATUS_LABEL: Record<PredictionStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  hit: 'Proven',
  miss: 'Busted',
  partial: 'Split',
  ambiguous: 'Unclear',
  void: 'Moot',
};

export function formatDate(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "41 days", "Tomorrow", "Today", "12 days overdue". */
export function formatCountdown(p: Prediction, now: Date = new Date()): string {
  const deadline = effectiveDeadline(p);
  if (!deadline) return 'No deadline';

  const days = daysUntilDeadline(p, now);
  if (days === null) return 'No deadline';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 45) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const years = days / 365;
  return years < 2 ? 'Over a year' : `${Math.round(years)} years`;
}

export function formatLateBadge(p: Prediction): string | null {
  const months = lateByMonths(p);
  if (months === null) return null;
  if (months < 1) return 'Called it, just late';
  if (months < 24) return `Called it, ${months} months late`;
  return `Called it, ${Math.round(months / 12)} years late`;
}

export function describeDeadline(p: Prediction): string {
  switch (p.deadlineType) {
    case 'fixed_date':
      return `By ${formatDate(p.resolutionDate)}`;
    case 'window':
      return `Between ${formatDate(p.windowStart)} and ${formatDate(p.windowEnd)}`;
    case 'event': {
      const race = p.raceEventB ? ` before ${p.raceEventB}` : '';
      return `When ${p.triggerEvent ?? 'the event'}${race} happens`;
    }
  }
}
