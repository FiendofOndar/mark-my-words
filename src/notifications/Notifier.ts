import type { PlannedNotification } from '../domain/notifications';

export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * Delivery. The plan is computed in the domain; this makes it real.
 *
 * Phase 0.6 adds a Capacitor implementation that schedules Android local
 * notifications with inline Yes/No actions. The browser one below can only fire
 * while a tab is open, which is honest about what a web build can do.
 */
export interface Notifier {
  readonly id: string;
  /** True when notifications can fire with the app closed. */
  readonly canScheduleWhileClosed: boolean;
  permission(): Promise<NotificationPermission>;
  request(): Promise<NotificationPermission>;
  /** Replace the whole schedule. Ids in the plan are stable, so this is idempotent. */
  schedule(plan: PlannedNotification[]): Promise<void>;
  cancelAll(): Promise<void>;
}

/**
 * Browser delivery, which is real but limited: setTimeout dies with the tab, so
 * only notifications due within this session are armed, and anything further
 * out is re-armed the next time the app is opened. The app says so in Settings
 * rather than implying it will reach you on a closed phone.
 */
export class BrowserNotifier implements Notifier {
  readonly id = 'browser';
  readonly canScheduleWhileClosed = false;

  private timers: ReturnType<typeof setTimeout>[] = [];
  /** Only arm what could plausibly fire before the tab is closed. */
  private readonly horizonMs = 6 * 3_600_000;

  async permission(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission as NotificationPermission;
  }

  async request(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') return 'unsupported';
    return (await Notification.requestPermission()) as NotificationPermission;
  }

  async schedule(plan: PlannedNotification[]): Promise<void> {
    await this.cancelAll();
    if ((await this.permission()) !== 'granted') return;

    const now = Date.now();
    for (const notification of plan) {
      const delay = new Date(notification.at).getTime() - now;
      if (delay < 0 || delay > this.horizonMs) continue;

      this.timers.push(
        setTimeout(() => {
          try {
            new Notification(notification.title, {
              body: notification.body,
              tag: notification.id,
            });
          } catch {
            /* the tab may have lost permission since */
          }
        }, delay),
      );
    }
  }

  async cancelAll(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}
