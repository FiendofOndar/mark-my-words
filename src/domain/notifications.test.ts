import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  MAX_SNOOZES,
  buildDigest,
  nextDigestAt,
  planNotifications,
  snoozePrompt,
  type NotificationPrefs,
} from './notifications';
import { makePrediction, isoDaysFrom } from './fixtures';
import type { Author } from './types';

// Local noon on a Wednesday, so day-boundary maths cannot drift with the runner's zone.
const NOW = new Date(2026, 8, 16, 12, 0, 0);

const authors = new Map<string, Author>([
  [
    'a-1',
    {
      id: 'a-1',
      displayName: 'Popops',
      handle: null,
      kind: 'person',
      avatarPath: null,
      notes: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      deletedAt: null,
    },
  ],
]);

const prefs = (overrides: Partial<NotificationPrefs> = {}): NotificationPrefs => ({
  ...DEFAULT_PREFS,
  ...overrides,
});

function plan(predictions = [makePrediction()], overrides: Partial<NotificationPrefs> = {}) {
  return planNotifications(predictions, authors, prefs(overrides), NOW);
}

describe('what gets scheduled', () => {
  it('schedules a deadline notification on the morning of the deadline', () => {
    const p = makePrediction({ resolutionDate: isoDaysFrom(NOW, 10) });
    const [deadline] = plan([p], { digest: false });

    expect(deadline).toMatchObject({ kind: 'deadline', predictionId: p.id });
    expect(new Date(deadline!.at).getHours()).toBe(DEFAULT_PREFS.deadlineHour);
    expect(new Date(deadline!.at).toDateString()).toBe(
      new Date(p.resolutionDate!).toDateString(),
    );
    expect(deadline!.body).toContain('Popops');
  });

  it('asks a yes or no question for a prediction only you can settle', () => {
    const p = makePrediction({
      verificationMode: 'manual',
      resolutionDate: isoDaysFrom(NOW, 5),
    });
    const [prompt] = plan([p], { digest: false });

    expect(prompt).toMatchObject({ kind: 'manual_prompt' });
    expect(prompt!.title).toBe('Did it happen?');
    expect(prompt!.actions.map((a) => a.id)).toEqual(['yes', 'no', 'later']);
  });

  it('skips anything already settled, deleted or still a draft', () => {
    const predictions = [
      makePrediction({ status: 'hit' }),
      makePrediction({ status: 'draft' }),
      makePrediction({ deletedAt: NOW.toISOString() }),
    ];
    expect(plan(predictions, { digest: false })).toEqual([]);
  });

  it('does not schedule a deadline that has already gone by', () => {
    const p = makePrediction({ resolutionDate: isoDaysFrom(NOW, -1) });
    expect(plan([p], { digest: false })).toEqual([]);
  });

  it('gives every notification a stable id so replanning replaces rather than duplicates', () => {
    const p = makePrediction({ resolutionDate: isoDaysFrom(NOW, 10) });
    const first = plan([p]);
    const second = plan([p]);
    expect(first.map((n) => n.id)).toEqual(second.map((n) => n.id));
    expect(first.find((n) => n.kind === 'deadline')!.id).toContain(p.id);
  });

  it('returns the plan in the order things will fire', () => {
    const soon = makePrediction({ resolutionDate: isoDaysFrom(NOW, 2) });
    const later = makePrediction({ resolutionDate: isoDaysFrom(NOW, 40) });
    const ids = plan([later, soon], { digest: false }).map((n) => n.predictionId);
    expect(ids).toEqual([soon.id, later.id]);
  });

  it('honors each toggle independently', () => {
    const predictions = [
      makePrediction({ resolutionDate: isoDaysFrom(NOW, 10) }),
      makePrediction({ verificationMode: 'manual', resolutionDate: isoDaysFrom(NOW, 10) }),
    ];
    expect(plan(predictions, { deadline: false, digest: false }).map((n) => n.kind)).toEqual([
      'manual_prompt',
    ]);
    expect(plan(predictions, { manualPrompt: false, digest: false }).map((n) => n.kind)).toEqual([
      'deadline',
    ]);
    expect(plan(predictions, { deadline: false, manualPrompt: false }).map((n) => n.kind)).toEqual([
      'digest',
    ]);
  });
});

describe('snoozing a manual prompt', () => {
  it('pushes the next ask a week out and counts the snooze', () => {
    const p = makePrediction({ verificationMode: 'manual' });
    const patch = snoozePrompt(p, NOW);
    expect(patch.promptSnoozes).toBe(1);
    expect(new Date(patch.promptNextAt).getTime() - NOW.getTime()).toBe(7 * 86_400_000);
  });

  it('asks at the snoozed time rather than the original deadline', () => {
    const p = makePrediction({
      verificationMode: 'manual',
      resolutionDate: isoDaysFrom(NOW, -3),
      promptNextAt: isoDaysFrom(NOW, 4),
      promptSnoozes: 1,
    });
    const [prompt] = plan([p], { digest: false });
    expect(prompt!.at).toBe(p.promptNextAt);
  });

  it('stops offering another delay once it has been put off enough', () => {
    const p = makePrediction({
      verificationMode: 'manual',
      promptNextAt: isoDaysFrom(NOW, 2),
      promptSnoozes: MAX_SNOOZES,
    });
    const [prompt] = plan([p], { digest: false });
    expect(prompt!.actions).toEqual([]);
    expect(prompt!.body).toMatch(/push the deadline/i);
  });
});

describe('the weekly digest', () => {
  it('lands on the configured day and hour, always in the future', () => {
    const at = new Date(nextDigestAt(prefs({ digestDay: 0, digestHour: 9 }), NOW));
    expect(at.getDay()).toBe(0);
    expect(at.getHours()).toBe(9);
    expect(at.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('rolls to next week when today is the digest day but the hour has passed', () => {
    const morning = new Date(2026, 8, 16, 12, 0, 0);
    const at = new Date(nextDigestAt(prefs({ digestDay: 3, digestHour: 9 }), morning));
    expect(at.getDay()).toBe(3);
    expect(at.getTime() - morning.getTime()).toBeGreaterThan(6 * 86_400_000);
  });

  it('summarizes what actually moved', () => {
    const digest = buildDigest(
      [
        makePrediction({ status: 'hit', resolvedAt: isoDaysFrom(NOW, -2) }),
        makePrediction({ status: 'miss', resolvedAt: isoDaysFrom(NOW, -60) }),
        makePrediction({ resolutionDate: isoDaysFrom(NOW, 12) }),
        makePrediction({ resolutionDate: isoDaysFrom(NOW, 300) }),
        makePrediction({ status: 'miss', lateHitAt: isoDaysFrom(NOW, -1) }),
      ],
      new Set<string>(),
      NOW,
    );

    expect(digest.resolvedThisWeek).toHaveLength(1);
    expect(digest.dueSoon).toHaveLength(1);
    expect(digest.lateHits).toHaveLength(1);
    expect(digest.line).toMatch(/1 settled/);
    expect(digest.line).toMatch(/1 late hit/);
  });

  it('counts what is waiting on the user', () => {
    const queued = makePrediction();
    const digest = buildDigest([queued], new Set([queued.id]), NOW);
    expect(digest.waitingOnYou).toBe(1);
    expect(digest.line).toMatch(/waiting on you/);
  });

  it('orders what is due soon by how soon', () => {
    const far = makePrediction({ resolutionDate: isoDaysFrom(NOW, 20) });
    const near = makePrediction({ resolutionDate: isoDaysFrom(NOW, 3) });
    const digest = buildDigest([far, near], new Set(), NOW);
    expect(digest.dueSoon.map((p) => p.id)).toEqual([near.id, far.id]);
  });

  it('says plainly when nothing happened', () => {
    expect(buildDigest([], new Set(), NOW).line).toBe('Nothing moved this week.');
  });
});
