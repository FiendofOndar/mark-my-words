import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  canTransition,
  confirmDraft,
  daysUntilDeadline,
  effectiveDeadline,
  endOfLocalDay,
  isUnderLateWatch,
  isWithinClaimPeriod,
  lateByMonths,
  lateWatchUntil,
  markLateHit,
  reopen,
  resolve,
  shouldStaleOut,
  toLocalDateInput,
} from './prediction';
import { NOW, isoDaysFrom, makePrediction } from './fixtures';

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
    const patch = resolve(p, 'hit', 'auto', NOW, { confidenceScore: 97 });
    expect(patch.status).toBe('hit');
    expect(patch.resolvedBy).toBe('auto');
    expect(patch.confidenceScore).toBe(97);
    expect(patch.trend).toBeNull();
  });

  it('starts a late watch on a miss and not on a hit', () => {
    const p = makePrediction();
    expect(resolve(p, 'miss', 'auto', NOW).lateWatchUntil).toBeTruthy();
    expect(resolve(p, 'hit', 'auto', NOW).lateWatchUntil).toBeNull();
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
