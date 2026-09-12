import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from './DbProvider';
import { BrowserNotifier, type NotificationPermission } from '../notifications/Notifier';
import { loadPrefs, savePrefs } from '../notifications/prefs';
import {
  DEFAULT_PREFS,
  planNotifications,
  type NotificationPrefs,
} from '../domain/notifications';

const notifier = new BrowserNotifier();

const PREFS_KEY = ['notification-prefs'] as const;
const PLAN_KEY = ['notification-plan'] as const;

/**
 * Preferences live in the query cache rather than component state, so the
 * settings screen and the scheduler read the same copy. Two useState instances
 * of the same row look identical and silently diverge.
 */
export function useNotificationPrefs() {
  const db = useDb();
  const client = useQueryClient();

  const { data: prefs = DEFAULT_PREFS } = useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => loadPrefs(db),
  });

  const mutation = useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) => {
      const next = savePrefs(db, patch);
      await db.driver.persist();
      return next;
    },
    // Applied before the write so a toggle does not visibly bounce back to its
    // old position while the database round trip finishes.
    onMutate: (patch) => {
      const previous = client.getQueryData<NotificationPrefs>(PREFS_KEY) ?? prefs;
      client.setQueryData(PREFS_KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) client.setQueryData(PREFS_KEY, context.previous);
    },
    onSettled: (next) => {
      if (next) client.setQueryData(PREFS_KEY, next);
      void client.invalidateQueries({ queryKey: PLAN_KEY });
    },
  });

  const update = useCallback(
    (patch: Partial<NotificationPrefs>) => mutation.mutate(patch),
    [mutation],
  );

  return { prefs, update };
}

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    void notifier.permission().then(setPermission);
  }, []);

  const request = useCallback(async () => {
    setPermission(await notifier.request());
  }, []);

  return { permission, request, canScheduleWhileClosed: notifier.canScheduleWhileClosed };
}

/**
 * Recompute and re-arm the whole schedule whenever the ledger or the
 * preferences change. Replacing the plan rather than adding to it is what makes
 * this safe to run repeatedly and, on Android, what recovers alarms the OS
 * dropped.
 */
export function useScheduledNotifications() {
  const db = useDb();
  const { prefs } = useNotificationPrefs();

  const { data: plan = [] } = useQuery({
    queryKey: [...PLAN_KEY, prefs],
    queryFn: () =>
      planNotifications(
        db.predictions.list(),
        new Map(db.authors.list().map((a) => [a.id, a])),
        prefs,
      ),
  });

  useEffect(() => {
    void notifier.schedule(plan);
  }, [plan]);

  return useMemo(() => ({ plan, next: plan[0] ?? null }), [plan]);
}
