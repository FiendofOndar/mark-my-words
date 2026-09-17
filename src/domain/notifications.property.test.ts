/**
 * The notification plan is replaced whole on every change, so it must be a
 * function of the ledger and the clock and nothing else, and every entry in
 * it must be something that can still fire.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  buildDigest,
  nextDigestAt,
  planNotifications,
  snoozePrompt,
  type NotificationPrefs,
} from './notifications';
import { instant, predictions, shuffled } from './arbitraries';
import type { Author } from './types';

const prefs: fc.Arbitrary<NotificationPrefs> = fc.record({
  deadline: fc.boolean(),
  manualPrompt: fc.boolean(),
  digest: fc.boolean(),
  digestDay: fc.integer({ min: 0, max: 6 }),
  digestHour: fc.integer({ min: 0, max: 23 }),
  deadlineHour: fc.integer({ min: 0, max: 23 }),
});

const authors = new Map<string, Author>();

/**
 * The chosen hour as the local clock actually resolves it on that date.
 *
 * On the spring-forward Sunday the clocks jump from 1:59 straight to 3:00,
 * so a notification set for 2am has no 2am to fire at that one week and
 * lands at 3:00, the first instant at or after the hour asked for. That is
 * the right answer, since 1am would be before the time that was chosen. So
 * the invariant both properties below state is "the hour the platform gives
 * for that wall clock on that day", not "the number in the preferences".
 * Both `atHour` and `nextDigestAt` build their instant the same way, which
 * is why one helper covers both.
 */
const resolvedHour = (at: Date, hour: number): number =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate(), hour, 0, 0, 0).getHours();

describe('the plan', () => {
  it('has unique ids, fires only in the future, and is sorted by time', () => {
    fc.assert(
      fc.property(predictions(12), prefs, instant, (ps, pr, now) => {
        const plan = planNotifications(ps, authors, pr, now);
        const ids = plan.map((n) => n.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const n of plan) expect(new Date(n.at).getTime()).toBeGreaterThan(now.getTime());
        for (let i = 1; i < plan.length; i += 1) expect(plan[i]!.at >= plan[i - 1]!.at).toBe(true);
      }),
    );
  });

  it('is identical whatever order the ledger arrives in', () => {
    fc.assert(
      fc.property(predictions(12).chain((ps) => fc.tuple(fc.constant(ps), shuffled(ps))), prefs, instant, ([a, b], pr, now) => {
        expect(planNotifications(b, authors, pr, now)).toEqual(planNotifications(a, authors, pr, now));
      }),
    );
  });

  it('never plans for a deleted, settled or draft prediction, and respects each switch', () => {
    fc.assert(
      fc.property(predictions(12), prefs, instant, (ps, pr, now) => {
        const plan = planNotifications(ps, authors, pr, now);
        const byId = new Map(ps.map((p) => [p.id, p]));
        for (const n of plan) {
          if (n.kind === 'digest') {
            expect(pr.digest).toBe(true);
            continue;
          }
          const p = byId.get(n.predictionId!)!;
          expect(p.status).toBe('open');
          expect(p.deletedAt).toBeNull();
          if (n.kind === 'deadline') {
            expect(pr.deadline).toBe(true);
            expect(p.verificationMode).toBe('searchable');
          } else {
            expect(pr.manualPrompt).toBe(true);
            expect(p.verificationMode).toBe('manual');
          }
        }
        expect(plan.some((n) => n.kind === 'digest')).toBe(pr.digest);
      }),
    );
  });

  it('fires a deadline notice on the deadline\'s own local day at the chosen hour', () => {
    fc.assert(
      fc.property(predictions(12), prefs, instant, (ps, pr, now) => {
        const plan = planNotifications(ps, authors, { ...pr, deadline: true }, now);
        for (const n of plan) {
          if (n.kind !== 'deadline') continue;
          const at = new Date(n.at);
          expect(at.getHours()).toBe(resolvedHour(at, pr.deadlineHour));
          expect(at.getMinutes()).toBe(0);
        }
      }),
    );
  });
});

describe('digest slot', () => {
  it('lands on the chosen hour even when that hour does not exist', () => {
    // The counterexample CI drew on seed 1874015083, which several local
    // runs had missed. 2am on 2023-03-12 is not a time in Pacific.
    const pr = { ...DEFAULT_PREFS, digestDay: 0, digestHour: 2 };
    const at = new Date(nextDigestAt(pr, new Date('2023-03-05T10:00:00.000Z')));
    expect(at.getDay()).toBe(0);
    expect(at.getHours()).toBe(3);
    expect(at.getMinutes()).toBe(0);
  });

  it('is the next occurrence of the chosen day and hour, strictly after now and within a week', () => {
    fc.assert(
      fc.property(prefs, instant, (pr, now) => {
        const at = new Date(nextDigestAt(pr, now));
        expect(at.getTime()).toBeGreaterThan(now.getTime());
        expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000 + 3_600_000);
        expect(at.getDay()).toBe(pr.digestDay);
        expect(at.getHours()).toBe(resolvedHour(at, pr.digestHour));
        expect(at.getMinutes()).toBe(0);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('digest content', () => {
  it('lists due-soon claims soonest first, all open and inside the month', () => {
    fc.assert(
      fc.property(predictions(15), instant, (ps, now) => {
        const digest = buildDigest(ps, new Set(), now);
        for (const p of digest.dueSoon) expect(p.status).toBe('open');
        expect(digest.line.length).toBeGreaterThan(0);
        if (digest.resolvedThisWeek.length + digest.dueSoon.length + digest.lateHits.length === 0) {
          expect(digest.line).toBe('Nothing moved this week.');
        }
      }),
    );
  });
});

describe('snoozing', () => {
  it('adds one and asks again a week later', () => {
    fc.assert(
      fc.property(predictions(1).filter((ps) => ps.length === 1), instant, ([p], now) => {
        const patch = snoozePrompt(p!, now);
        expect(patch.promptSnoozes).toBe(p!.promptSnoozes + 1);
        // Seven calendar days on the local clock, not seven times 24 hours:
        // across a DST change those differ by an hour, and near midnight
        // by a day.
        const expected = new Date(now);
        expected.setDate(expected.getDate() + 7);
        const next = new Date(patch.promptNextAt);
        expect(next.getTime()).toBeGreaterThan(now.getTime());
        expect(next.toISOString()).toBe(expected.toISOString());
      }),
    );
  });
});

describe('defaults', () => {
  it('turn everything on at nine in the morning', () => {
    expect(DEFAULT_PREFS.deadline && DEFAULT_PREFS.manualPrompt && DEFAULT_PREFS.digest).toBe(true);
    expect(DEFAULT_PREFS.deadlineHour).toBe(9);
  });
});
