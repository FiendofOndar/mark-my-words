import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  canTransition,
  checkedButUnsettled,
  confirmDraft,
  daysUntilDeadline,
  effectiveDeadline,
  endOfLocalDay,
  isUnderLateWatch,
  isWithinClaimPeriod,
  criteriaMarksFor,
  lateByMonths,
  lateWatchUntil,
  markLateHit,
  reopen,
  resolve,
  shouldStaleOut,
  toLocalDateInput,
} from './prediction';
import { NOW, isoDaysFrom, makePrediction } from './fixtures';
import { formatCountdown } from './format';

describe('transitions', () => {
  it('lets a draft open and nothing else', () => {
    expect(canTransition('draft', 'open')).toBe(true);
    expect(canTransition('draft', 'hit')).toBe(false);
  });

  it('lets an open prediction reach every resolved state', () => {
    for (const s of ['hit', 'miss', 'partial', 'ambiguous', 'void'] as const) {
      expect(canTransition('open', s)).toBe(true);
    }
    expect(canTransition('open', 'draft')).toBe(false);
  });

  it('allows reopening and correcting a verdict', () => {
    expect(canTransition('hit', 'open')).toBe(true);
    expect(canTransition('hit', 'miss')).toBe(true);
    expect(canTransition('hit', 'hit')).toBe(false);
  });

  it('throws on an illegal resolve', () => {
    const p = makePrediction({ status: 'draft' });
    expect(() => resolve(p, 'hit', 'user', NOW)).toThrow(InvalidTransitionError);
  });
});

describe('resolving', () => {
  it('records who resolved it and clears the trend', () => {
    const p = makePrediction();
    const patch = resolve(p, 'hit', 'auto', NOW);
    expect(patch.status).toBe('hit');
    expect(patch.resolvedBy).toBe('auto');
    expect(patch.trend).toBeNull();
  });

  it('starts a late watch on a miss that could still come true, and not on a hit', () => {
    // "Bitcoin above $100k by the end of 2024" is a fixed date and can still
    // happen in 2025. The flag, not the deadline type, is what decides.
    const p = makePrediction({ canHappenLate: true, resolutionDate: isoDaysFrom(NOW, -1) });
    expect(resolve(p, 'miss', 'auto', NOW).lateWatchUntil).toBeTruthy();
    expect(resolve(p, 'hit', 'auto', NOW).lateWatchUntil).toBeNull();
  });

  it('does not watch a miss that cannot come true later', () => {
    // Every miss used to get three years of monthly checks, each a paid call
    // asking whether a day's high temperature had changed.
    const p = makePrediction({ canHappenLate: false, resolutionDate: isoDaysFrom(NOW, -1) });
    expect(resolve(p, 'miss', 'auto', NOW).lateWatchUntil).toBeNull();
    expect(resolve(p, 'miss', 'auto', NOW, { lateWatch: '1y' }).lateWatchUntil).toBeTruthy();
  });

  it('honors a late watch period of never', () => {
    const p = makePrediction();
    expect(resolve(p, 'miss', 'auto', NOW, { lateWatch: 'never' }).lateWatchUntil).toBeNull();
  });

  it('reopening marks the change as a user override', () => {
    const p = makePrediction({ status: 'hit', resolvedAt: NOW.toISOString() });
    const patch = reopen(p, NOW);
    expect(patch.status).toBe('open');
    expect(patch.resolvedBy).toBe('user_override');
    expect(patch.resolvedAt).toBeNull();
  });

  it('confirming a draft starts the clock', () => {
    const p = makePrediction({ status: 'draft', trend: null });
    expect(confirmDraft(p, NOW).status).toBe('open');
  });
});

describe('criteria marks for a verdict called by hand', () => {
  const criteria = [
    { id: 'a', satisfied: null },
    { id: 'b', satisfied: true },
    { id: 'c', satisfied: false },
  ];

  it('ticks everything on a hit', () => {
    expect(criteriaMarksFor('hit', criteria)).toEqual([
      { id: 'a', satisfied: true },
      { id: 'b', satisfied: true },
      { id: 'c', satisfied: true },
    ]);
  });

  it('crosses what was not already met on a miss', () => {
    expect(criteriaMarksFor('miss', criteria)).toEqual([
      { id: 'a', satisfied: false },
      { id: 'c', satisfied: false },
    ]);
  });

  it('leaves a partial or ambiguous call alone', () => {
    expect(criteriaMarksFor('partial', criteria)).toEqual([]);
    expect(criteriaMarksFor('ambiguous', criteria)).toEqual([]);
    expect(criteriaMarksFor('void', criteria)).toEqual([]);
  });
});

describe('late hits', () => {
  it('keeps the verdict at miss', () => {
    const p = makePrediction({ status: 'miss' });
    const patch = markLateHit(p, '2027-04-01T00:00:00.000Z', NOW);
    expect(patch.status).toBeUndefined();
    expect(patch.lateHitAt).toBe('2027-04-01T00:00:00.000Z');
  });

  it('refuses to mark a late hit on anything but a miss', () => {
    const p = makePrediction({ status: 'hit' });
    expect(() => markLateHit(p, NOW.toISOString(), NOW)).toThrow();
  });

  it('reports the delay in months', () => {
    const p = makePrediction({
      status: 'miss',
      resolutionDate: '2024-07-15T23:59:59.999Z',
      lateHitAt: '2025-11-04T00:00:00.000Z',
    });
    expect(lateByMonths(p)).toBe(16);
  });

  it('is under late watch only while the window is open and nothing has landed', () => {
    const base = { status: 'miss' as const, lateWatchUntil: isoDaysFrom(NOW, 30) };
    expect(isUnderLateWatch(makePrediction(base), NOW)).toBe(true);
    expect(isUnderLateWatch(makePrediction({ ...base, lateHitAt: NOW.toISOString() }), NOW)).toBe(false);
    expect(
      isUnderLateWatch(makePrediction({ ...base, lateWatchUntil: isoDaysFrom(NOW, -1) }), NOW),
    ).toBe(false);
  });

  it('computes a late watch end date', () => {
    expect(lateWatchUntil('2026-01-01T00:00:00.000Z', '1y')).toBe('2027-01-01T00:00:00.000Z');
    expect(lateWatchUntil('2026-01-01T00:00:00.000Z', 'never')).toBeNull();
  });
});

describe('deadlines', () => {
  it('uses the window end for a window prediction', () => {
    const p = makePrediction({
      deadlineType: 'window',
      resolutionDate: null,
      windowStart: '2026-12-01T00:00:00.000Z',
      windowEnd: '2027-03-20T23:59:59.999Z',
    });
    expect(effectiveDeadline(p)).toBe('2027-03-20T23:59:59.999Z');
  });

  it('falls back from expected date to stale-out for an event', () => {
    const withExpected = makePrediction({
      deadlineType: 'event',
      resolutionDate: null,
      triggerExpectedDate: '2027-05-01T00:00:00.000Z',
      staleOutDate: '2031-01-01T00:00:00.000Z',
    });
    expect(effectiveDeadline(withExpected)).toBe('2027-05-01T00:00:00.000Z');

    const withoutExpected = makePrediction({
      deadlineType: 'event',
      resolutionDate: null,
      triggerExpectedDate: null,
      staleOutDate: '2031-01-01T00:00:00.000Z',
    });
    expect(effectiveDeadline(withoutExpected)).toBe('2031-01-01T00:00:00.000Z');
  });

  it('counts days to the deadline and goes negative when overdue', () => {
    expect(daysUntilDeadline(makePrediction({ resolutionDate: isoDaysFrom(NOW, 41) }), NOW)).toBe(41);
    expect(daysUntilDeadline(makePrediction({ resolutionDate: isoDaysFrom(NOW, -3) }), NOW)).toBe(-3);
  });

  it('treats a hit anywhere inside a window as on time', () => {
    const p = makePrediction({
      deadlineType: 'window',
      resolutionDate: null,
      windowStart: '2026-12-01T00:00:00.000Z',
      windowEnd: '2027-03-20T23:59:59.999Z',
    });
    expect(isWithinClaimPeriod(p, new Date('2027-01-15T00:00:00.000Z'))).toBe(true);
    expect(isWithinClaimPeriod(p, new Date('2027-04-15T00:00:00.000Z'))).toBe(false);
  });

  it('stales out an event that ran out its rope', () => {
    const p = makePrediction({
      deadlineType: 'event',
      resolutionDate: null,
      staleOutDate: isoDaysFrom(NOW, -1),
    });
    expect(shouldStaleOut(p, NOW)).toBe(true);
    expect(shouldStaleOut(makePrediction({ ...p, status: 'hit' }), NOW)).toBe(false);
  });

  it('round-trips a date-only deadline through the local end of day', () => {
    const iso = endOfLocalDay('2026-10-31');
    expect(toLocalDateInput(iso)).toBe('2026-10-31');
    expect(new Date(iso).getHours()).toBe(23);
  });
});

describe('checked but unsettled', () => {
  const overdue = (extra: Parameters<typeof makePrediction>[0] = {}) =>
    makePrediction({ resolutionDate: isoDaysFrom(NOW, -2), ...extra });

  it('asks the user once the app has looked since the deadline and come up short', () => {
    // The real one: three checks, zero citations the app could confirm, and the
    // prediction sat at "1 day overdue" forever with nothing pointing at it.
    expect(checkedButUnsettled(overdue({ lastCheckedAt: isoDaysFrom(NOW, -1) }), NOW)).toBe(true);
  });

  it('waits until the app has actually tried', () => {
    expect(checkedButUnsettled(overdue({ lastCheckedAt: null }), NOW)).toBe(false);
    // Checked, but before the deadline, so the answer could not have been there.
    expect(checkedButUnsettled(overdue({ lastCheckedAt: isoDaysFrom(NOW, -5) }), NOW)).toBe(false);
  });

  it('leaves alone anything already settled or not yet due', () => {
    expect(
      checkedButUnsettled(overdue({ status: 'miss', lastCheckedAt: isoDaysFrom(NOW, -1) }), NOW),
    ).toBe(false);
    expect(
      checkedButUnsettled(
        makePrediction({ resolutionDate: isoDaysFrom(NOW, 30), lastCheckedAt: isoDaysFrom(NOW, -1) }),
        NOW,
      ),
    ).toBe(false);
  });

  it('says nothing about a manual prediction, which the feed already asks about', () => {
    expect(
      checkedButUnsettled(
        overdue({ verificationMode: 'manual', lastCheckedAt: isoDaysFrom(NOW, -1) }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe('counting days to a deadline', () => {
  // Deadlines are stored as the end of their local day, which is how the app
  // records "by Halloween".
  const endOf = (y: number, m: number, d: number) =>
    new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();

  const at = (resolutionDate: string) => makePrediction({ resolutionDate });

  it('counts a deadline later today as today', () => {
    const now = new Date(2026, 8, 12, 13, 0, 0);
    expect(daysUntilDeadline(at(endOf(2026, 9, 12)), now)).toBe(0);
  });

  it('counts last night as one day overdue, not as today', () => {
    // The bug this replaced: thirteen hours elapsed is less than a day, so it
    // rounded to zero and an expired prediction reported "Today".
    const now = new Date(2026, 8, 12, 13, 0, 0);
    expect(daysUntilDeadline(at(endOf(2026, 9, 11)), now)).toBe(-1);
  });

  it('counts a minute past midnight as overdue', () => {
    const now = new Date(2026, 8, 12, 0, 1, 0);
    expect(daysUntilDeadline(at(endOf(2026, 9, 11)), now)).toBe(-1);
  });

  it('counts tomorrow as one day out regardless of the hour', () => {
    for (const hour of [0, 9, 23]) {
      const now = new Date(2026, 8, 12, hour, 30, 0);
      expect(daysUntilDeadline(at(endOf(2026, 9, 13)), now)).toBe(1);
    }
  });

  it('says overdue rather than today once the day has passed', () => {
    const now = new Date(2026, 8, 12, 13, 0, 0);
    expect(formatCountdown(at(endOf(2026, 9, 11)), now)).toBe('1 day overdue');
    expect(formatCountdown(at(endOf(2026, 9, 12)), now)).toBe('Today');
    expect(formatCountdown(at(endOf(2026, 9, 13)), now)).toBe('Tomorrow');
  });
});
