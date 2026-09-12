import { describe, expect, it } from 'vitest';
import { describeQuotaFailure, parseQuotaFailure } from './quotaError';

function body(details: unknown[]) {
  return JSON.stringify({
    error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED', details },
  });
}

const quotaFailure = (quotaId: string, quotaMetric = '', quotaValue = '10') => ({
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
  violations: [{ quotaId, quotaMetric, quotaValue }],
});

const retryInfo = (delay: string) => ({
  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
  retryDelay: delay,
});

describe('reading which limit was hit', () => {
  it('recognizes a per-minute limit', () => {
    const f = parseQuotaFailure(
      body([quotaFailure('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), retryInfo('45s')]),
    );
    expect(f).toMatchObject({ scope: 'minute', limit: '10', retryAfterSeconds: 45 });
  });

  it('recognizes a per-day limit', () => {
    const f = parseQuotaFailure(
      body([quotaFailure('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '', '250')]),
    );
    expect(f?.scope).toBe('day');
    expect(f?.limit).toBe('250');
  });

  it('recognizes the separate grounding allowance', () => {
    const f = parseQuotaFailure(
      body([
        quotaFailure(
          'GroundingWithGoogleSearchRequestsPerDayPerProject-FreeTier',
          'generativelanguage.googleapis.com/grounding_with_google_search_requests',
        ),
      ]),
    );
    // Grounding is checked before the per-day pattern, because its quota id
    // contains both and the grounding bucket is the useful thing to report.
    expect(f?.scope).toBe('grounding');
  });

  it('reads a retry delay even with no violation block', () => {
    const f = parseQuotaFailure(body([retryInfo('12s')]));
    expect(f).toMatchObject({ scope: 'unknown', retryAfterSeconds: 12 });
  });

  it('returns nothing for a body with no quota detail at all', () => {
    expect(parseQuotaFailure(body([]))).toBeNull();
    expect(parseQuotaFailure('{"error":{"code":429}}')).toBeNull();
    expect(parseQuotaFailure('not json')).toBeNull();
  });
});

describe('what the user is told', () => {
  it('does not claim a daily limit when the limit was per minute', () => {
    const message = describeQuotaFailure(
      parseQuotaFailure(body([quotaFailure('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), retryInfo('45s')])),
    );
    expect(message).toMatch(/last minute/i);
    expect(message).toMatch(/45 seconds/);
    expect(message).not.toMatch(/tomorrow/i);
  });

  it('says plainly when the day really is gone', () => {
    const message = describeQuotaFailure(
      parseQuotaFailure(body([quotaFailure('GenerateRequestsPerDayPerProjectPerModel-FreeTier')])),
    );
    expect(message).toMatch(/used up/i);
    expect(message).toMatch(/midnight/i);
  });

  it('explains that drafting still works when only grounding is exhausted', () => {
    const message = describeQuotaFailure(
      parseQuotaFailure(body([quotaFailure('GroundingWithGoogleSearchRequestsPerDay-FreeTier')])),
    );
    expect(message).toMatch(/drafting still works/i);
  });

  it('stays vague rather than wrong when the body says nothing useful', () => {
    const message = describeQuotaFailure(null);
    expect(message).toMatch(/wait a moment/i);
    expect(message).not.toMatch(/tomorrow|minute allowance/i);
  });

  it('scales the wait it quotes', () => {
    const at = (delay: string) =>
      describeQuotaFailure(parseQuotaFailure(body([quotaFailure('X-PerMinute'), retryInfo(delay)])));
    expect(at('30s')).toMatch(/30 seconds/);
    expect(at('300s')).toMatch(/5 minutes/);
  });
});
