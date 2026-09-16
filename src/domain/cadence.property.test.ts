/**
 * The cadence gate is the whole scheduling system and every check it lets
 * through costs money. These are the rules it must hold for any ledger.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MIN_GAP_MS, checkIntervalDays, checkPriority, isDueForCheck, planPull } from './cadence';
import { isUnderLateWatch } from './prediction';
import { instant, isoInstant, prediction, predictions, shuffled } from './arbitraries';
import { makePrediction } from './fixtures';

describe('due for check', () => {
  it('never spends on a draft, a manual claim, a deleted row, or a settled one outside late watch', () => {
    fc.assert(
      fc.property(prediction, instant, (p, now) => {
        const due = isDueForCheck(p, now).due;
        if (p.status === 'draft' || p.verificationMode === 'manual' || p.deletedAt) return !due;
        if (p.status !== 'open' && !isUnderLateWatch(p, now)) return !due;
        return true;
      }),
    );
  });

  it('never checks before noCheckBefore, and never twice inside the minimum gap', () => {
    fc.assert(
      fc.property(prediction, instant, (p, now) => {
        const result = isDueForCheck(p, now);
        if (!result.due) return true;
        if (p.noCheckBefore && new Date(p.noCheckBefore).getTime() > now.getTime()) return false;
        if (!p.lastCheckedAt) return true;
        return now.getTime() - new Date(p.lastCheckedAt).getTime() >= MIN_GAP_MS;
      }),
    );
  });

  it('a check just recorded makes the same prediction not due', () => {
    fc.assert(
      fc.property(prediction, instant, (p, now) => {
        const checked = { ...p, lastCheckedAt: now.toISOString() };
        return !isDueForCheck(checked, now).due;
      }),
    );
  });
});

describe('interval', () => {
  it('checks no less often as the deadline approaches', () => {
    fc.assert(
      fc.property(instant, fc.integer({ min: -400, max: 800 }), fc.integer({ min: -400, max: 800 }), (now, d1, d2) => {
        const [far, near] = d1 >= d2 ? [d1, d2] : [d2, d1];
        const at = (days: number) =>
          makePrediction({ resolutionDate: new Date(now.getTime() + days * 86_400_000).toISOString() });
        const farInterval = checkIntervalDays(at(far), now)!;
        const nearInterval = checkIntervalDays(at(near), now)!;
        return nearInterval <= farInterval;
      }),
    );
  });

  it('is null exactly for a settled prediction outside late watch', () => {
    fc.assert(
      fc.property(prediction, instant, (p, now) => {
        const interval = checkIntervalDays(p, now);
        const expectNull = p.status !== 'open' && !isUnderLateWatch(p, now);
        return (interval === null) === expectNull;
      }),
    );
  });
});

describe('planning a pull', () => {
  it('spends at most the budget, defers the rest, and loses nothing', () => {
    fc.assert(
      fc.property(predictions(15), instant, fc.integer({ min: 0, max: 8 }), (ps, now, budget) => {
        const plan = planPull(ps, now, budget);
        const due = ps.filter((p) => isDueForCheck(p, now).due);
        expect(plan.toCheck.length).toBeLessThanOrEqual(budget);
        expect(plan.skipped).toBe(ps.length - due.length);
        const planned = [...plan.toCheck, ...plan.deferred].map((p) => p.id).sort();
        expect(planned).toEqual(due.map((p) => p.id).sort());
      }),
    );
  });

  it('never defers something more urgent than what it checks', () => {
    fc.assert(
      fc.property(predictions(15), instant, fc.integer({ min: 0, max: 8 }), (ps, now, budget) => {
        const plan = planPull(ps, now, budget);
        const worstChecked = Math.max(0, ...plan.toCheck.map((p) => checkPriority(p, now)));
        const bestDeferred = Math.min(5, ...plan.deferred.map((p) => checkPriority(p, now)));
        return worstChecked <= bestDeferred;
      }),
    );
  });

  it('checks the same predictions whatever order the rows arrive in', () => {
    // Which rows get the budget must not depend on the order the database
    // happened to return them in, or two loads spend on different claims.
    fc.assert(
      fc.property(
        predictions(12).chain((ps) => fc.tuple(fc.constant(ps), shuffled(ps))),
        instant,
        fc.integer({ min: 0, max: 6 }),
        ([ps, mixed], now, budget) => {
          const a = planPull(ps, now, budget).toCheck.map((p) => p.id);
          const b = planPull(mixed, now, budget).toCheck.map((p) => p.id);
          expect(b).toEqual(a);
        },
      ),
    );
  });

  it('two never-checked claims with the same deadline are split the same way from either order', () => {
    // The tie the generator rarely finds. Two claims "by the end of the
    // year" share a deadline to the millisecond and neither has been
    // checked, so priority, staleness and deadline all tie. Without a last
    // word, the one that gets the budget is whichever the database
    // returned first.
    const deadline = '2026-12-31T23:59:59.999Z';
    const now = new Date('2026-09-16T12:00:00.000Z');
    const a = makePrediction({ id: 'p-a', resolutionDate: deadline });
    const b = makePrediction({ id: 'p-b', resolutionDate: deadline });
    const first = planPull([a, b], now, 1).toCheck.map((p) => p.id);
    const second = planPull([b, a], now, 1).toCheck.map((p) => p.id);
    expect(second).toEqual(first);
  });

  it('an overdue open claim is checked before any never-checked one due later', () => {
    fc.assert(
      fc.property(isoInstant(), instant, (deadline, now) => {
        const overdue = makePrediction({
          resolutionDate: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
          lastCheckedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
        });
        const fresh = makePrediction({
          resolutionDate: new Date(now.getTime() + 40 * 86_400_000).toISOString(),
        });
        const plan = planPull([fresh, overdue], now, 1);
        return plan.toCheck[0]?.id === overdue.id;
      }),
    );
  });
});
