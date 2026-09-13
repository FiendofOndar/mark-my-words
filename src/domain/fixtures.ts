import type { Prediction } from './types';

let counter = 0;

/** Minimal valid prediction for tests. Override whatever the test cares about. */
export function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  counter += 1;
  const now = '2026-09-12T12:00:00.000Z';
  return {
    id: `p-${counter}`,
    authorId: 'a-1',
    rawStatement: 'Something will happen.',
    normalizedClaim: 'Something will happen.',
    polarity: 'positive',
    disconfirmingTrigger: null,
    statementDate: '2026-09-01T12:00:00.000Z',
    sourceUrl: null,
    archiveUrl: null,
    archiveStatus: 'not_applicable',
    archiveAttempts: 0,
    screenshotPath: null,
    sourceContext: null,
    deadlineType: 'fixed_date',
    resolutionDate: '2026-12-01T23:59:59.999Z',
    windowStart: null,
    windowEnd: null,
    triggerEvent: null,
    triggerExpectedDate: null,
    raceEventB: null,
    staleOutDate: null,
    verificationMode: 'searchable',
    forceManual: false,
    searchQueries: [],
    noCheckBefore: null,
    status: 'open',
    trend: 'unknown',
    resolvedAt: null,
    resolvedBy: null,
    lateHitAt: null,
    lateWatchUntil: null,
    category: 'Other',
    isRetroactive: false,
    stakes: null,
    criteriaFrozenAt: null,
    intakeNotes: null,
    promptSnoozes: 0,
    promptNextAt: null,
    lastCheckedAt: null,
    checkCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

export const NOW = new Date('2026-09-12T12:00:00.000Z');

export function isoDaysFrom(base: Date, days: number): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString();
}
