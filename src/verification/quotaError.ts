/**
 * Reading a Gemini 429.
 *
 * A 429 covers three different limits, and the response already says which one
 * was hit and how long to wait. Assuming the worst of the three tells the user
 * to come back tomorrow when the real answer is usually to wait a minute.
 */
export type QuotaScope = 'minute' | 'day' | 'grounding' | 'unknown';

export interface QuotaFailure {
  scope: QuotaScope;
  quotaId: string | null;
  /** The limit itself, when Google states it. */
  limit: string | null;
  /** From RetryInfo, in seconds. */
  retryAfterSeconds: number | null;
}

interface Violation {
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string;
}

export function parseQuotaFailure(body: string): QuotaFailure | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const details = (parsed as { error?: { details?: unknown[] } })?.error?.details;
  if (!Array.isArray(details)) return null;

  let violation: Violation | null = null;
  let retryAfterSeconds: number | null = null;

  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue;
    const d = detail as Record<string, unknown>;
    const type = String(d['@type'] ?? '');

    if (type.endsWith('QuotaFailure') && Array.isArray(d.violations)) {
      violation ??= (d.violations[0] as Violation) ?? null;
    }
    if (type.endsWith('RetryInfo') && typeof d.retryDelay === 'string') {
      const seconds = Number(d.retryDelay.replace(/s$/, ''));
      if (Number.isFinite(seconds)) retryAfterSeconds = seconds;
    }
  }

  if (!violation && retryAfterSeconds === null) return null;

  const quotaId = violation?.quotaId ?? null;
  const metric = violation?.quotaMetric ?? '';

  return {
    scope: scopeOf(quotaId, metric),
    quotaId,
    limit: violation?.quotaValue ?? null,
    retryAfterSeconds,
  };
}

function scopeOf(quotaId: string | null, metric: string): QuotaScope {
  const haystack = `${quotaId ?? ''} ${metric}`.toLowerCase();
  // Grounding is billed and limited separately from generation, so a check can
  // fail on it while drafting still works fine.
  if (haystack.includes('grounding') || haystack.includes('search')) return 'grounding';
  if (haystack.includes('perminute') || haystack.includes('per_minute')) return 'minute';
  if (haystack.includes('perday') || haystack.includes('per_day')) return 'day';
  return 'unknown';
}

/** What to actually tell someone looking at a failed check. */
export function describeQuotaFailure(failure: QuotaFailure | null): string {
  if (!failure) return 'Rate limited. Wait a moment and try again.';

  const wait =
    failure.retryAfterSeconds !== null
      ? ` Try again in ${formatWait(failure.retryAfterSeconds)}.`
      : '';
  const limit = failure.limit ? ` (limit ${failure.limit})` : '';

  switch (failure.scope) {
    case 'minute':
      return `Too many requests in the last minute${limit}.${wait || ' Try again in a minute.'}`;
    case 'day':
      return `Today's request allowance is used up${limit}. It resets at midnight Pacific.`;
    case 'grounding':
      return `The web-search allowance is used up${limit}. Drafting still works; checking does not.${wait}`;
    default:
      return `Rate limited${limit}.${wait || ' Wait a moment and try again.'}`;
  }
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}
