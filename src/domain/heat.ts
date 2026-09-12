/**
 * Feed ordering. The most interesting thing is always on top, which for this
 * app means whatever is overdue, waiting on the user, or about to land.
 */
import type { Prediction } from './types';
import { daysUntilDeadline, effectiveDeadline, isUnderLateWatch } from './prediction';

export interface HeatInput {
  prediction: Prediction;
  /** a check proposed a verdict in the 80-94 band and is waiting for approval */
  hasQueuedVerdict?: boolean;
  /** the most recent check changed the trend */
  trendChanged?: boolean;
  /** evidence arrived since the user last opened this prediction */
  newEvidence?: boolean;
}

export function heatScore(input: HeatInput, now: Date = new Date()): number {
  const p = input.prediction;
  if (p.deletedAt) return -1;

  let heat = 0;
  const days = daysUntilDeadline(p, now);

  if (p.status === 'open' && days !== null && days < 0) heat += 100;
  if (input.hasQueuedVerdict) heat += 90;
  if (p.status === 'draft') heat += 80;
  if (days !== null && p.status === 'open') heat += Math.max(0, 60 - days);
  if (input.trendChanged) heat += 30;
  if (input.newEvidence) heat += 20;
  if (p.status === 'open' && !p.lastCheckedAt) heat += 10;

  // A resolved prediction is cold, but a fresh late hit is worth surfacing.
  if (isUnderLateWatch(p, now)) heat += 5;
  if (p.lateHitAt) heat += 15;

  return heat;
}

export function sortByHeat(inputs: HeatInput[], now: Date = new Date()): HeatInput[] {
  return [...inputs].sort((a, b) => {
    const diff = heatScore(b, now) - heatScore(a, now);
    if (diff !== 0) return diff;

    // Heat flattens past sixty days out, so everything further away scores the
    // same and the tail of the feed came out in whatever order the rows
    // happened to arrive in. Two loads of identical data listed a five-month
    // prediction above and below a two-year one. Soonest first is what reading
    // down a list of deadlines implies.
    const da = deadlineMs(a);
    const db = deadlineMs(b);
    if (da !== db) {
      // Open-ended claims have no date to compare, so they sink below the ones
      // that do rather than sorting as though they were due immediately.
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }

    const updated =
      new Date(b.prediction.updatedAt).getTime() - new Date(a.prediction.updatedAt).getTime();
    if (updated !== 0) return updated;

    // Last resort. Rows written in one transaction share a millisecond, and two
    // of them must not be free to swap between renders.
    return a.prediction.id < b.prediction.id ? -1 : a.prediction.id > b.prediction.id ? 1 : 0;
  });
}

function deadlineMs(input: HeatInput): number | null {
  const iso = effectiveDeadline(input.prediction);
  return iso === null ? null : new Date(iso).getTime();
}
