import { describe, expect, it } from 'vitest';
import { DEFAULT_PULL_BUDGET, checkIntervalDays, isDueForCheck, planPull } from './cadence';
import { NOW, isoDaysFrom, makePrediction } from './fixtures';

describe('check interval', () => {
  it('scales with time remaining', () => {
    const at = (days: number) => makePrediction({ resolutionDate: isoDaysFrom(NOW, days) });
    expect(checkIntervalDays(at(400), NOW)).toBe(30);
    expect(checkIntervalDays(at(181), NOW)).toBe(30);
    expect(checkIntervalDays(at(180), NOW)).toBe(14);
    expect(checkIntervalDays(at(31), NOW)).toBe(14);
    expect(checkIntervalDays(at(30), NOW)).toBe(7);
    expect(checkIntervalDays(at(8), NOW)).toBe(7);
    expect(checkIntervalDays(at(7), NOW)).toBe(0);
    expect(checkIntervalDays(at(-5), NOW)).toBe(0);
  });

  it('puts a late-watched miss on the slow cadence', () => {
    const p = makePrediction({
      status: 'miss',
      resolutionDate: isoDaysFrom(NOW, -400),
      lateWatchUntil: isoDaysFrom(NOW, 365),
    });
    expect(checkIntervalDays(p, NOW)).toBe(30);
  });
});

describe('due for check', () => {
  it('never checks a draft, a manual prediction, or a deleted one', () => {
    expect(isDueForCheck(makePrediction({ status: 'draft' }), NOW).due).toBe(false);
    expect(isDueForCheck(makePrediction({ verificationMode: 'manual' }), NOW).due).toBe(false);
    expect(isDueForCheck(makePrediction({ deletedAt: NOW.toISOString() }), NOW).due).toBe(false);
  });

  it('never checks a resolved prediction unless it is under late watch', () => {
    expect(isDueForCheck(makePrediction({ status: 'hit' }), NOW).due).toBe(false);
    const lateWatched = makePrediction({
      status: 'miss',
      resolutionDate: isoDaysFrom(NOW, -400),
      lateWatchUntil: isoDaysFrom(NOW, 365),
      lastCheckedAt: isoDaysFrom(NOW, -40),
    });
    expect(isDueForCheck(lateWatched, NOW).due).toBe(true);
  });

  it('respects noCheckBefore', () => {
    const p = makePrediction({ noCheckBefore: isoDaysFrom(NOW, 10) });
    expect(isDueForCheck(p, NOW).due).toBe(false);
  });

  it('checks anything that has never been checked', () => {
    const p = makePrediction({ resolutionDate: isoDaysFrom(NOW, 300), lastCheckedAt: null });
    expect(isDueForCheck(p, NOW)).toMatchObject({ due: true, reason: 'Never checked' });
  });

  it('holds a far-off prediction until its interval elapses', () => {
    const base = { resolutionDate: isoDaysFrom(NOW, 300) };
    expect(isDueForCheck(makePrediction({ ...base, lastCheckedAt: isoDaysFrom(NOW, -29) }), NOW).due).toBe(false);
    expect(isDueForCheck(makePrediction({ ...base, lastCheckedAt: isoDaysFrom(NOW, -31) }), NOW).due).toBe(true);
  });

  it('enforces a 12 hour floor inside the final week', () => {
    const base = { resolutionDate: isoDaysFrom(NOW, 3) };
    const justChecked = makePrediction({ ...base, lastCheckedAt: isoDaysFrom(NOW, -0.25) });
    const checkedYesterday = makePrediction({ ...base, lastCheckedAt: isoDaysFrom(NOW, -1) });
    expect(isDueForCheck(justChecked, NOW).due).toBe(false);
    expect(isDueForCheck(checkedYesterday, NOW).due).toBe(true);
  });
});

describe('pull planning', () => {
  it('spends the budget on the highest priority items and defers the rest', () => {
    const overdue = makePrediction({
      resolutionDate: isoDaysFrom(NOW, -5),
      lastCheckedAt: isoDaysFrom(NOW, -2),
    });
    const soon = makePrediction({
      resolutionDate: isoDaysFrom(NOW, 3),
      lastCheckedAt: isoDaysFrom(NOW, -2),
    });
    const far = makePrediction({ resolutionDate: isoDaysFrom(NOW, 300), lastCheckedAt: null });

    const plan = planPull([far, soon, overdue], NOW, 2);
    expect(plan.toCheck.map((p) => p.id)).toEqual([overdue.id, soon.id]);
    expect(plan.deferred.map((p) => p.id)).toEqual([far.id]);
  });

  it('does not count predictions that were never due as deferred', () => {
    const notDue = makePrediction({ status: 'hit' });
    const due = makePrediction({ resolutionDate: isoDaysFrom(NOW, 300) });
    const plan = planPull([notDue, due], NOW);
    expect(plan.toCheck).toHaveLength(1);
    expect(plan.deferred).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });

  it('orders the stalest first within a tier', () => {
    const older = makePrediction({
      resolutionDate: isoDaysFrom(NOW, 300),
      lastCheckedAt: isoDaysFrom(NOW, -90),
    });
    const newer = makePrediction({
      resolutionDate: isoDaysFrom(NOW, 300),
      lastCheckedAt: isoDaysFrom(NOW, -40),
    });
    const plan = planPull([newer, older], NOW);
    expect(plan.toCheck.map((p) => p.id)).toEqual([older.id, newer.id]);
  });

  it('spends no more than the default budget and defers the rest', () => {
    const many = Array.from({ length: DEFAULT_PULL_BUDGET + 4 }, () =>
      makePrediction({ resolutionDate: isoDaysFrom(NOW, 300) }),
    );
    const plan = planPull(many, NOW);
    expect(plan.toCheck).toHaveLength(DEFAULT_PULL_BUDGET);
    expect(plan.deferred).toHaveLength(4);
  });
});
