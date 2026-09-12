import { LocalNotifications } from '@capacitor/local-notifications';
import type { PlannedNotification } from '../domain/notifications';
import type { Notifier, NotificationPermission } from '../notifications/Notifier';

const MANUAL_ACTION_TYPE = 'MMW_MANUAL_PROMPT';

/**
 * Android local notifications. Scheduled on device, so they fire with the app
 * closed, and the manual prompt carries real Yes / No / Not yet buttons.
 *
 * The whole schedule is cancelled and re-armed on every call. That is
 * deliberate: OEM battery managers silently drop pending alarms, so the plan
 * has to be re-asserted rather than trusted.
 */
export class CapacitorNotifier implements Notifier {
  readonly id = 'capacitor';
  readonly canScheduleWhileClosed = true;

  private registered = false;

  async permission(): Promise<NotificationPermission> {
    return toPermission((await LocalNotifications.checkPermissions()).display);
  }

  async request(): Promise<NotificationPermission> {
    return toPermission((await LocalNotifications.requestPermissions()).display);
  }

  async schedule(plan: PlannedNotification[]): Promise<void> {
    if ((await this.permission()) !== 'granted') return;
    await this.registerActions();
    await this.cancelAll();

    const now = Date.now();
    const due = plan.filter((n) => new Date(n.at).getTime() > now);
    if (due.length === 0) return;

    await LocalNotifications.schedule({
      notifications: due.map((n) => ({
        // Android wants a 32-bit int, and the id has to be stable across
        // replans so the same notification is replaced rather than duplicated.
        id: stableId(n.id),
        title: n.title,
        body: n.body,
        schedule: { at: new Date(n.at), allowWhileIdle: true },
        actionTypeId: n.actions.length > 0 ? MANUAL_ACTION_TYPE : undefined,
        extra: { predictionId: n.predictionId, kind: n.kind },
      })),
    });
  }

  async cancelAll(): Promise<void> {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length === 0) return;
    await LocalNotifications.cancel(pending);
  }

  private async registerActions(): Promise<void> {
    if (this.registered) return;
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: MANUAL_ACTION_TYPE,
          actions: [
            { id: 'yes', title: 'Yes' },
            { id: 'no', title: 'No' },
            { id: 'later', title: 'Not yet' },
          ],
        },
      ],
    });
    this.registered = true;
  }
}

/** Capacitor's two "not asked yet" states both mean the same thing here. */
function toPermission(state: string): NotificationPermission {
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  return 'default';
}

/** FNV-1a, folded into the positive 32-bit range Android accepts. */
function stableId(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash | 0) % 2_147_483_647;
}
