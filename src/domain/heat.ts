/**
 * Feed ordering. The most interesting thing is always on top, which for this
 * app means whatever is overdue, waiting on the user, or about to land.
 */
import type { Prediction } from './types';
import { daysUntilDeadline, isUnderLateWatch } from './prediction';

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
    return (
      new Date(b.prediction.updatedAt).getTime() - new Date(a.prediction.updatedAt).getTime()
    );
  });
}
