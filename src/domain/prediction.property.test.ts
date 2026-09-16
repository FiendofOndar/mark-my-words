/**
 * Invariants of the state machine and the date math, checked over generated
 * predictions rather than hand-picked ones. Each block names the rule in
 * plain words first; the generator does the rest.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  RESOLVED_STATUSES,
  canTransition,
  confirmDraft,
  criteriaMarksFor,
  daysUntilDeadline,
  effectiveDeadline,
  endOfLocalDay,
  isPastDeadline,
  isResolved,
  isUnderLateWatch,
  lateWatchUntil,
  reopen,
  resolve,
  startOfLocalDay,
  toLocalDateInput,
} from './prediction';
import { STATUSES, dateOnly, instant, isoInstant, prediction, status } from './arbitraries';

describe('transitions', () => {
  it('never allows a status to move to itself', () => {
    fc.assert(fc.property(status, (s) => !canTransition(s, s)));
  });

  it('only opens a draft, and never returns anything to draft', () => {
    fc.assert(
      fc.property(status, status, (from, to) => {
        if (to === 'draft') return !canTransition(from, to);
        if (from === 'draft') return canTransition(from, to) === (to === 'open');
        return true;
      }),
    );
  });

  it('lets any verdict be corrected to any other verdict, or reopened', () => {
    fc.assert(
      fc.property(status, status, (from, to) => {
        if (!isResolved(from) || from === to) return true;
        return canTransition(from, to) === (to === 'open' || isResolved(to));
      }),
    );
  });

  it('resolve throws exactly when the transition is illegal', () => {
    fc.assert(
      fc.property(prediction, status, instant, (p, verdict, now) => {
        const legal = isResolved(verdict) && canTransition(p.status, verdict);
        if (legal) {
          expect(resolve(p, verdict, 'user', now).status).toBe(verdict);
        } else {
          expect(() => resolve(p, verdict, 'user', now)).toThrow(InvalidTransitionError);
        }
      }),
    );
  });
});

describe('resolving', () => {
  const settling = fc
    .tuple(prediction, fc.constantFrom(...RESOLVED_STATUSES), instant)
    .filter(([p, v]) => canTransition(p.status, v));

  it('sets late watch only on a miss with a deadline, and always after the deadline', () => {
    fc.assert(
      fc.property(settling, ([p, verdict, now]) => {
        const patch = resolve(p, verdict, 'auto', now);
        const deadline = effectiveDeadline(p);
        if (verdict !== 'miss' || !deadline || !p.canHappenLate) {
          expect(patch.lateWatchUntil).toBeNull();
        } else {
          expect(patch.lateWatchUntil).not.toBeNull();
          expect(new Date(patch.lateWatchUntil!).getTime()).toBeGreaterThan(new Date(deadline).getTime());
        }
      }),
    );
  });

  it('clears the trend and stamps the resolution instant', () => {
    fc.assert(
      fc.property(settling, ([p, verdict, now]) => {
        const patch = resolve(p, verdict, 'user', now);
        expect(patch.trend).toBeNull();
        expect(patch.resolvedAt).toBe(now.toISOString());
        expect(patch.updatedAt).toBe(now.toISOString());
      }),
    );
  });

  it('never leaves a late-hit stamp on a prediction that is no longer a miss', () => {
    // A late hit is a fact about a miss: the thing happened after the
    // deadline the claim named. Corrected to another verdict, the stamp
    // would still add heat, count in the standings and print the badge.
    fc.assert(
      fc.property(settling, ([p, verdict, now]) => {
        if (verdict === 'miss') return;
        const after = { ...p, ...resolve(p, verdict, 'user', now) };
        expect(after.lateHitAt).toBeNull();
      }),
    );
  });

  it('reopening clears everything a verdict carried', () => {
    fc.assert(
      fc.property(prediction.filter((p) => isResolved(p.status)), instant, (p, now) => {
        const after = { ...p, ...reopen(p, now) };
        expect(after.status).toBe('open');
        expect(after.resolvedAt).toBeNull();
        expect(after.lateWatchUntil).toBeNull();
        expect(after.lateHitAt).toBeNull();
        expect(isUnderLateWatch(after, now)).toBe(false);
      }),
    );
  });

  it('confirming a draft freezes the criteria at that instant', () => {
    fc.assert(
      fc.property(prediction.filter((p) => p.status === 'draft'), instant, (p, now) => {
        const patch = confirmDraft(p, now);
        expect(patch.status).toBe('open');
        expect(patch.criteriaFrozenAt).toBe(now.toISOString());
      }),
    );
  });
});

describe('late watch', () => {
  it('is only ever a miss without a late hit, before its watch runs out', () => {
    fc.assert(
      fc.property(prediction, instant, (p, now) => {
        if (!isUnderLateWatch(p, now)) return true;
        return p.status === 'miss' && p.lateHitAt === null && new Date(p.lateWatchUntil!).getTime() > now.getTime();
      }),
    );
  });

  it('a one-year watch ends before a three-year one, and both after the deadline', () => {
    fc.assert(
      fc.property(isoInstant(), (deadline) => {
        const one = new Date(lateWatchUntil(deadline, '1y')!).getTime();
        const three = new Date(lateWatchUntil(deadline, '3y')!).getTime();
        const at = new Date(deadline).getTime();
        return at < one && one < three && lateWatchUntil(deadline, 'never') === null;
      }),
    );
  });
});

describe('criteria marks', () => {
  const criteria = fc.array(
    fc.record({ id: fc.uuid(), satisfied: fc.constantFrom(true, false, null) }),
    { maxLength: 8 },
  );

  it('a hit ticks every criterion and a miss never untucks a tick', () => {
    fc.assert(
      fc.property(criteria, (cs) => {
        const hit = criteriaMarksFor('hit', cs);
        expect(hit.map((m) => m.id)).toEqual(cs.map((c) => c.id));
        expect(hit.every((m) => m.satisfied)).toBe(true);

        const miss = criteriaMarksFor('miss', cs);
        const ticked = new Set(cs.filter((c) => c.satisfied === true).map((c) => c.id));
        expect(miss.some((m) => ticked.has(m.id))).toBe(false);
        expect(miss.every((m) => !m.satisfied)).toBe(true);
        expect(miss.length).toBe(cs.length - ticked.size);
      }),
    );
  });

  it('every other verdict says nothing about the criteria', () => {
    fc.assert(
      fc.property(
        criteria,
        fc.constantFrom(...STATUSES.filter((s) => s !== 'hit' && s !== 'miss')),
        (cs, v) => criteriaMarksFor(v, cs).length === 0,
      ),
    );
  });
});

describe('local days', () => {
  it('a date input survives the trip to end of day and back', () => {
    fc.assert(fc.property(dateOnly, (d) => toLocalDateInput(endOfLocalDay(d)) === d));
  });

  it('a date input survives the trip to start of day and back', () => {
    fc.assert(fc.property(dateOnly, (d) => toLocalDateInput(startOfLocalDay(d)) === d));
  });

  it('counts calendar days, whole, across DST changes', () => {
    // Independent computation: difference of the two local calendar dates
    // taken as UTC midnights, which has no DST to trip over.
    const civil = (iso: string) => {
      const [y, m, d] = toLocalDateInput(iso).split('-').map(Number);
      return Date.UTC(y!, m! - 1, d!);
    };
    fc.assert(
      fc.property(prediction, instant, (p, now) => {
        const deadline = effectiveDeadline(p);
        const days = daysUntilDeadline(p, now);
        if (!deadline) return days === null;
        return days === Math.round((civil(deadline) - civil(now.toISOString())) / 86_400_000);
      }),
    );
  });

  it('a negative day count means the deadline has passed, and never the reverse on a later day', () => {
    fc.assert(
      fc.property(prediction, instant, (p, now) => {
        const days = daysUntilDeadline(p, now);
        if (days === null) return !isPastDeadline(p, now);
        if (days < 0) return isPastDeadline(p, now);
        if (days > 0) return !isPastDeadline(p, now);
        return true; // today: depends on the hour
      }),
    );
  });

  it('never moves further away as time passes', () => {
    fc.assert(
      fc.property(prediction, instant, instant, (p, t1, t2) => {
        const [early, late] = t1 <= t2 ? [t1, t2] : [t2, t1];
        const a = daysUntilDeadline(p, early);
        const b = daysUntilDeadline(p, late);
        if (a === null || b === null) return a === b;
        return b <= a;
      }),
    );
  });
});
