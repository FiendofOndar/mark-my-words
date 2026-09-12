import type { Db } from '../data/db';
import { DEFAULT_PREFS, type NotificationPrefs } from '../domain/notifications';

/**
 * Notification preferences are app configuration rather than a device secret,
 * so they live in the database and travel with an export.
 */
const KEY = 'notification_prefs';

export function loadPrefs(db: Db): NotificationPrefs {
  return { ...DEFAULT_PREFS, ...db.settings.getJson<Partial<NotificationPrefs>>(KEY, {}) };
}

export function savePrefs(db: Db, prefs: Partial<NotificationPrefs>): NotificationPrefs {
  const next = { ...loadPrefs(db), ...prefs };
  db.settings.setJson(KEY, next);
  return next;
}
