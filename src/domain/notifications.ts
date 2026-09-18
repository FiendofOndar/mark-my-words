/**
 * What should be scheduled, given the current state of the ledger.
 *
 * Pure. The delivery mechanism (browser Notification API now, Android local
 * notifications in 0.6) takes this plan and makes it real. Recomputing the
 * whole plan on every app open is deliberate: Android's battery managers drop
 * scheduled alarms, so the plan has to be re-asserted rather than incremented.
 */
import type { Author, Prediction } from './types';
import { daysUntilDeadline, effectiveDeadline, isResolved } from './prediction';
import { formatCountdown } from './format';

export type NotificationKind = 'deadline' | 'manual_prompt' | 'digest';

export interface NotificationAction {
  id: 'yes' | 'no' | 'later';
  title: string;
}

export interface PlannedNotification {
  /** Stable across replans, so rescheduling replaces rather than duplicates. */
  id: string;
  kind: NotificationKind;
  predictionId: string | null;
  at: string;
  title: string;
  body: string;
  actions: NotificationAction[];
}

export interface NotificationPrefs {
  deadline: boolean;
  manualPrompt: boolean;
  digest: boolean;
  /** 0 = Sunday. */
  digestDay: number;
  digestHour: number;
  /** Hour of the day a deadline notification fires. */
  deadlineHour: number;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  deadline: true,
  manualPrompt: true,
  digest: true,
  digestDay: 0,
  digestHour: 9,
  deadlineHour: 9,
};

/** How many times a manual prompt may be put off before it asks for a decision. */
export const MAX_SNOOZES = 4;
export const SNOOZE_DAYS = 7;

const MANUAL_ACTIONS: NotificationAction[] = [
  { id: 'yes', title: 'Yes' },
  { id: 'no', title: 'No' },
  { id: 'later', title: 'Not yet' },
];

function atHour(iso: string, hour: number): string {
  const day = new Date(iso);
  const local = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
  return local.toISOString();
}

export function planNotifications(
  predictions: Prediction[],
  authors: Map<string, Author>,
  prefs: NotificationPrefs,
  now: Date = new Date(),
): PlannedNotification[] {
  const planned: PlannedNotification[] = [];

  for (const p of predictions) {
    if (p.deletedAt) continue;
    if (p.status !== 'open') continue;

    const who = authors.get(p.authorId)?.displayName ?? 'Someone';

    if (p.verificationMode === 'manual') {
      if (!prefs.manualPrompt) continue;
      const at = manualPromptAt(p, prefs);
      if (!at || new Date(at).getTime() <= now.getTime()) continue;

      const exhausted = p.promptSnoozes >= MAX_SNOOZES;
      planned.push({
        id: `manual:${p.id}`,
        kind: 'manual_prompt',
        predictionId: p.id,
        at,
        title: exhausted ? 'Still open, still unanswered' : 'Did it happen?',
        body: exhausted
          ? `"${truncate(p.rawStatement)}" has been put off ${p.promptSnoozes} times. Settle it or push the deadline.`
          : `${who}: "${truncate(p.rawStatement)}"`,
        actions: exhausted ? [] : MANUAL_ACTIONS,
      });
      continue;
    }

    if (!prefs.deadline) continue;
    const deadline = effectiveDeadline(p);
    if (!deadline) continue;

    const at = atHour(deadline, prefs.deadlineHour);
    if (new Date(at).getTime() <= now.getTime()) continue;

    planned.push({
      id: `deadline:${p.id}`,
      kind: 'deadline',
      predictionId: p.id,
      at,
      title: "Today's the day",
      body: `${who} said "${truncate(p.rawStatement)}"`,
      actions: [],
    });
  }

  if (prefs.digest) {
    planned.push(buildDigestNotification(predictions, prefs, now));
  }

  return planned.sort((a, b) => a.at.localeCompare(b.at));
}

function manualPromptAt(p: Prediction, prefs: NotificationPrefs): string | null {
  if (p.promptNextAt) return p.promptNextAt;
  const deadline = effectiveDeadline(p);
  return deadline ? atHour(deadline, prefs.deadlineHour) : null;
}

/**
 * The next digest slot strictly after now.
 *
 * The hour is set on the target day, never on today and then carried across
 * the day arithmetic. On the spring-forward Sunday a digest set for 2am has
 * no 2am, so setHours lands on 3am; adding seven days to that then put the
 * slot at 3am on an ordinary Sunday that has a perfectly good 2am. Set the
 * wall clock last and each day resolves the hour for itself.
 */
export function nextDigestAt(prefs: NotificationPrefs, now: Date = new Date()): string {
  const slotIn = (days: number): Date => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(prefs.digestHour, 0, 0, 0);
    return d;
  };

  const dayGap = (prefs.digestDay - slotIn(0).getDay() + 7) % 7;
  const candidate = slotIn(dayGap);
  return (candidate.getTime() <= now.getTime() ? slotIn(dayGap + 7) : candidate).toISOString();
}

export interface DigestContent {
  resolvedThisWeek: Prediction[];
  dueSoon: Prediction[];
  waitingOnYou: number;
  lateHits: Prediction[];
  line: string;
}

export function buildDigest(
  predictions: Prediction[],
  queuedPredictionIds: Set<string>,
  now: Date = new Date(),
): DigestContent {
  const weekAgo = now.getTime() - 7 * 86_400_000;

  const live = predictions.filter((p) => !p.deletedAt);

  const resolvedThisWeek = live.filter(
    (p) => isResolved(p.status) && p.resolvedAt && new Date(p.resolvedAt).getTime() >= weekAgo,
  );

  const dueSoon = live
    .filter((p) => {
      if (p.status !== 'open') return false;
      const days = daysUntilDeadline(p, now);
      return days !== null && days >= 0 && days <= 30;
    })
    .sort((a, b) => (daysUntilDeadline(a, now) ?? 0) - (daysUntilDeadline(b, now) ?? 0));

  const lateHits = live.filter(
    (p) => p.lateHitAt && new Date(p.lateHitAt).getTime() >= weekAgo,
  );

  const waitingOnYou = live.filter((p) => queuedPredictionIds.has(p.id)).length;

  const parts: string[] = [];
  if (resolvedThisWeek.length > 0) parts.push(`${resolvedThisWeek.length} settled`);
  if (waitingOnYou > 0) parts.push(`${waitingOnYou} waiting on you`);
  if (lateHits.length > 0)
    parts.push(`${lateHits.length} late hit${lateHits.length === 1 ? '' : 's'}`);
  if (dueSoon.length > 0) parts.push(`${dueSoon.length} due within a month`);

  return {
    resolvedThisWeek,
    dueSoon,
    lateHits,
    waitingOnYou,
    line: parts.length > 0 ? parts.join(' · ') : 'Nothing moved this week.',
  };
}

function buildDigestNotification(
  predictions: Prediction[],
  prefs: NotificationPrefs,
  now: Date,
): PlannedNotification {
  const at = nextDigestAt(prefs, now);
  const soonest = predictions
    .filter((p) => p.status === 'open')
    .map((p) => ({ p, days: daysUntilDeadline(p, now) }))
    .filter((x) => x.days !== null && x.days >= 0)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))[0];

  return {
    id: 'digest',
    kind: 'digest',
    predictionId: null,
    at,
    title: 'The week on the record',
    body: soonest
      ? `Next up: "${truncate(soonest.p.rawStatement, 60)}" in ${formatCountdown(soonest.p, now)}.`
      : 'Open the ledger to see where things stand.',
    actions: [],
  };
}

function truncate(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Putting a manual prompt off for another week. */
export function snoozePrompt(p: Prediction, now: Date = new Date()) {
  const next = new Date(now);
  next.setDate(next.getDate() + SNOOZE_DAYS);
  return {
    promptSnoozes: p.promptSnoozes + 1,
    promptNextAt: next.toISOString(),
    updatedAt: now.toISOString(),
  };
}
