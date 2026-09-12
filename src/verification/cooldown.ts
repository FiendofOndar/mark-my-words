/**
 * Refusing to spend an allowance that is already gone.
 *
 * Grounded checks on a free Gemini key come out of a 20-per-day bucket. Once it
 * is empty, every further attempt is a guaranteed failure that costs a request,
 * fills the check log with identical errors, and teaches the user nothing. So
 * the app stops asking until the bucket refills.
 */
import type { QuotaScope } from './quotaError';

export interface Cooldown {
  until: string;
  scope: QuotaScope;
  reason: string;
}

/**
 * Google's daily quotas reset at midnight Pacific, not local midnight and not
 * on a rolling 24 hours.
 */
export function nextPacificMidnight(now: Date = new Date()): Date {
  const pacificNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const offsetMs = now.getTime() - pacificNow.getTime();

  const nextMidnightPacific = new Date(pacificNow);
  nextMidnightPacific.setHours(24, 0, 0, 0);

  return new Date(nextMidnightPacific.getTime() + offsetMs);
}

export function cooldownFor(
  scope: QuotaScope,
  retryAfterSeconds: number | null,
  now: Date = new Date(),
): Cooldown | null {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return {
      until: new Date(now.getTime() + retryAfterSeconds * 1000).toISOString(),
      scope,
      reason: 'The provider asked for a wait.',
    };
  }

  switch (scope) {
    case 'day':
    case 'grounding':
      return {
        until: nextPacificMidnight(now).toISOString(),
        scope,
        reason: "Today's allowance is gone. It resets at midnight Pacific.",
      };
    case 'unknown':
      // A limit with no stated wait and no named metric is, in practice, the
      // daily bucket: a per-minute limit always carries a retry delay.
      return {
        until: nextPacificMidnight(now).toISOString(),
        scope,
        reason:
          'The provider reported a spent quota with no retry time, which is how a daily limit looks. Waiting for the reset at midnight Pacific.',
      };
    case 'minute':
      return {
        until: new Date(now.getTime() + 60_000).toISOString(),
        scope,
        reason: 'Too many requests in the last minute.',
      };
  }
}

export function isCoolingDown(cooldown: Cooldown | null, now: Date = new Date()): boolean {
  if (!cooldown) return false;
  return new Date(cooldown.until).getTime() > now.getTime();
}

export function describeCooldown(cooldown: Cooldown, now: Date = new Date()): string {
  const ms = new Date(cooldown.until).getTime() - now.getTime();
  if (ms <= 0) return 'Ready to check again.';

  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${cooldown.reason} About ${minutes} minute${minutes === 1 ? '' : 's'} to go.`;

  const hours = Math.round(minutes / 60);
  return `${cooldown.reason} About ${hours} hour${hours === 1 ? '' : 's'} to go.`;
}
