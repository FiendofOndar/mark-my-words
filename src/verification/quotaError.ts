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
  /** Google's own prose. Often the only thing present. */
  message: string | null;
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
    // Not JSON at all. The raw body is still better than a canned sentence.
    const text = body.trim();
    return text ? { scope: 'unknown', quotaId: null, limit: null, retryAfterSeconds: null, message: text.slice(0, 400) } : null;
  }

  const error = (parsed as { error?: { details?: unknown[]; message?: string } })?.error;
  const message = typeof error?.message === 'string' ? error.message : null;
  const details = Array.isArray(error?.details) ? error.details : [];

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

  if (!violation && retryAfterSeconds === null && !message) return null;

  const quotaId = violation?.quotaId ?? null;
  const metric = violation?.quotaMetric ?? '';

  return {
    // The structured block is not always sent. Google's prose usually names the
    // limit anyway, so it is classified too rather than thrown away.
    scope: scopeOf(quotaId, `${metric} ${message ?? ''}`),
    quotaId,
    limit: violation?.quotaValue ?? null,
    retryAfterSeconds,
    message,
  };
}

function scopeOf(quotaId: string | null, metric: string): QuotaScope {
  const haystack = `${quotaId ?? ''} ${metric}`.toLowerCase().replace(/[\s_-]+/g, '');
  // Grounding is billed and limited separately from generation, so a check can
  // fail on it while drafting still works fine.
  if (haystack.includes('grounding') || haystack.includes('googlesearch')) return 'grounding';
  if (haystack.includes('perminute') || haystack.includes('perminuteper')) return 'minute';
  if (haystack.includes('perday')) return 'day';
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
      // Unclassified. Google's own words beat a canned sentence that says
      // nothing, which is exactly how the last version wasted everyone's time.
      return failure.message
        ? `Rate limited: ${failure.message}`
        : `Rate limited${limit}.${wait || ' Wait a moment and try again.'}`;
  }
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}
