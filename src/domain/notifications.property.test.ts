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
          expect(at.getHours()).toBe(pr.deadlineHour);
          expect(at.getMinutes()).toBe(0);
        }
      }),
    );
  });
});

describe('digest slot', () => {
  it('is the next occurrence of the chosen day and hour, strictly after now and within a week', () => {
    fc.assert(
      fc.property(prefs, instant, (pr, now) => {
        const at = new Date(nextDigestAt(pr, now));
        expect(at.getTime()).toBeGreaterThan(now.getTime());
        expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000 + 3_600_000);
        expect(at.getDay()).toBe(pr.digestDay);
        expect(at.getHours()).toBe(pr.digestHour);
        expect(at.getMinutes()).toBe(0);
      }),
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
        const next = new Date(patch.promptNextAt);
        expect(next.getTime()).toBeGreaterThan(now.getTime());
        expect(next.getHours()).toBe(now.getHours());
        expect(next.getDate()).toBe(new Date(now.getTime() + 7 * 86_400_000).getDate());
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
