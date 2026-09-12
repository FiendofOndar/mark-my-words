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
  /** Consecutive unclassified quota failures, for escalating the wait. */
  strikes?: number;
}

/**
 * How long to sit out an unclassified quota error, escalating.
 *
 * A free key's daily exhaustion and a paid key's momentary limit can look
 * identical: both are a bare 429 with no metric and no retry delay. Assuming
 * the worst strands a paid account until morning over a transient blip, so the
 * first one is a short wait and only a repeat is treated as the day being gone.
 */
const UNKNOWN_BACKOFF_MS = [15 * 60_000, 60 * 60_000];

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
  /** How many unclassified quota failures have happened in a row. */
  strikes = 1,
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
    case 'unknown': {
      const backoff = UNKNOWN_BACKOFF_MS[strikes - 1];
      if (backoff === undefined) {
        return {
          until: nextPacificMidnight(now).toISOString(),
          scope,
          strikes,
          reason:
            'The provider has reported a spent quota repeatedly, which is how a daily limit looks. Waiting for the reset at midnight Pacific.',
        };
      }
      return {
        until: new Date(now.getTime() + backoff).toISOString(),
        scope,
        strikes,
        reason: 'The provider reported a spent quota without saying for how long.',
      };
    }
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
