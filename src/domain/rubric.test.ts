import { describe, expect, it } from 'vitest';
import {
  AUTO_RESOLVE_AT,
  QUEUE_AT,
  countIndependentSources,
  scoreCheck,
  type RubricInput,
  type SourceAssessment,
} from './rubric';

const STATEMENT = '2026-01-01T00:00:00.000Z';

function source(overrides: Partial<SourceAssessment> = {}): SourceAssessment {
  return {
    url: 'https://apnews.com/article/one',
    publisher: 'AP',
    tier: 'primary',
    fetchStatus: 'ok',
    publishedAt: '2026-06-01',
    ...overrides,
  };
}

function input(overrides: Partial<RubricInput> = {}): RubricInput {
  return {
    sources: [
      source(),
      source({ url: 'https://reuters.com/a', publisher: 'Reuters' }),
      source({ url: 'https://bbc.co.uk/a', publisher: 'BBC' }),
    ],
    coverage: 'all_quoted',
    modelConfidence: 90,
    statementDate: STATEMENT,
    claimPeriodEnd: '2026-12-31T23:59:59.999Z',
    proposedVerdict: 'hit',
    forceManual: false,
    isRetroactive: false,
    ...overrides,
  };
}

describe('independent sources', () => {
  it('counts one per publisher, not one per article', () => {
    expect(
      countIndependentSources([
        source({ url: 'https://apnews.com/1' }),
        source({ url: 'https://apnews.com/2' }),
      ]),
    ).toBe(1);
  });

  it('falls back to the hostname when no publisher is named', () => {
    expect(
      countIndependentSources([
        source({ url: 'https://www.espn.com/a', publisher: null }),
        source({ url: 'https://espn.com/b', publisher: null }),
        source({ url: 'https://reuters.com/c', publisher: null }),
      ]),
    ).toBe(2);
  });
});

describe('scoring', () => {
  it('gives a clean, well-sourced result a perfect evidence score', () => {
    const result = scoreCheck(input({ modelConfidence: 100 }));
    expect(result.breakdown.evidenceTotal).toBe(100);
    expect(result.breakdown).toMatchObject({
      independentSources: 30,
      sourceTier: 25,
      urlValidation: 20,
      criteriaCoverage: 15,
      temporalSanity: 10,
    });
    expect(result.decision).toBe('auto_resolve');
  });

  it('scales points with the number of independent sources', () => {
    const at = (n: number) =>
      scoreCheck(
        input({
          sources: Array.from({ length: n }, (_, i) =>
            source({ url: `https://outlet${i}.com/a`, publisher: `Outlet ${i}` }),
          ),
        }),
      ).breakdown.independentSources;
    expect(at(1)).toBe(10);
    expect(at(2)).toBe(22);
    expect(at(3)).toBe(30);
    expect(at(6)).toBe(30);
  });

  it('takes the highest source tier present', () => {
    const result = scoreCheck(
      input({
        sources: [
          source({ tier: 'social', publisher: 'A' }),
          source({ tier: 'major_outlet', publisher: 'B' }),
        ],
      }),
    );
    expect(result.breakdown.sourceTier).toBe(18);
  });
});

describe('model confidence is a cap, not a bonus', () => {
  it('cannot raise a weak evidence score', () => {
    const result = scoreCheck(
      input({
        sources: [source({ tier: 'social', publisher: 'A blog' })],
        coverage: 'inferred',
        modelConfidence: 99,
      }),
    );
    expect(result.score).toBeLessThan(QUEUE_AT);
    expect(result.decision).toBe('hold');
  });

  it('pulls a perfect evidence score down when the model is unsure', () => {
    const result = scoreCheck(input({ modelConfidence: 60 }));
    expect(result.breakdown.evidenceTotal).toBe(100);
    expect(result.score).toBe(80);
    expect(result.breakdown.capApplied).toBe(true);
    expect(result.decision).toBe('queue');
  });

  it('does not cap when the model reported nothing', () => {
    const result = scoreCheck(input({ modelConfidence: null }));
    expect(result.score).toBe(100);
    expect(result.breakdown.capApplied).toBe(false);
  });
});

describe('url validation', () => {
  it('zeroes the dimension and gates the result when a source does not resolve', () => {
    const result = scoreCheck(
      input({
        sources: [
          source({ publisher: 'AP' }),
          source({ publisher: 'Reuters', fetchStatus: 'unreachable' }),
        ],
      }),
    );
    expect(result.breakdown.urlValidation).toBe(0);
    expect(result.gates.join(' ')).toMatch(/invented citations/i);
    expect(result.decision).not.toBe('auto_resolve');
  });

  it('gives half credit when most sources validated', () => {
    const result = scoreCheck(
      input({
        sources: [
          source({ publisher: 'AP' }),
          source({ publisher: 'Reuters' }),
          source({ publisher: 'BBC', fetchStatus: 'quote_not_found' }),
        ],
      }),
    );
    expect(result.breakdown.urlValidation).toBe(10);
  });

  it('treats a blocked source as unchecked rather than as a fake citation', () => {
    // This is the browser case: CORS stops the app from reading the page, but
    // the page is not therefore invented.
    const result = scoreCheck(
      input({ sources: input().sources.map((s) => ({ ...s, fetchStatus: 'blocked' as const })) }),
    );
    expect(result.breakdown.urlValidation).toBe(0);
    expect(result.gates).toEqual([]);
    expect(result.score).toBe(80);
    expect(result.decision).toBe('queue');
  });
});

describe('temporal sanity', () => {
  it('zeroes and gates when a source predates the prediction', () => {
    const result = scoreCheck(
      input({ sources: [source({ publishedAt: '2011-10-28' }), source({ publisher: 'Reuters' })] }),
    );
    expect(result.breakdown.temporalSanity).toBe(0);
    expect(result.gates.join(' ')).toMatch(/predates/i);
  });

  it('allows older sources on a retroactive entry', () => {
    const result = scoreCheck(
      input({
        isRetroactive: true,
        statementDate: '2026-01-01T00:00:00.000Z',
        sources: [
          source({ publishedAt: '2024-06-01', publisher: 'AP' }),
          source({ publishedAt: '2024-06-02', publisher: 'Reuters' }),
          source({ publishedAt: '2024-06-03', publisher: 'BBC' }),
        ],
        claimPeriodEnd: '2026-12-31T00:00:00.000Z',
      }),
    );
    expect(result.breakdown.temporalSanity).toBe(10);
    expect(result.gates).toEqual([]);
  });

  it('zeroes when a source has no date at all', () => {
    const result = scoreCheck(input({ sources: [source({ publishedAt: null }), source({ publisher: 'R' })] }));
    expect(result.breakdown.temporalSanity).toBe(0);
  });

  it('zeroes when a source postdates the period the claim covered', () => {
    const result = scoreCheck(
      input({ sources: [source({ publishedAt: '2027-06-01' }), source({ publisher: 'R' })] }),
    );
    expect(result.breakdown.temporalSanity).toBe(0);
  });
});

describe('hard gates', () => {
  it('never auto-resolves on a single source, however good', () => {
    const result = scoreCheck(
      input({ sources: [source()], coverage: 'all_quoted', modelConfidence: 100 }),
    );
    expect(result.gates.join(' ')).toMatch(/one independent source/i);
    expect(result.decision).not.toBe('auto_resolve');
  });

  it('never auto-resolves a partial or ambiguous verdict', () => {
    for (const verdict of ['partial', 'ambiguous'] as const) {
      const result = scoreCheck(input({ proposedVerdict: verdict, modelConfidence: 100 }));
      expect(result.score).toBeGreaterThanOrEqual(AUTO_RESOLVE_AT);
      expect(result.decision).toBe('queue');
    }
  });

  it('never auto-resolves when the user asked to call it themselves', () => {
    const result = scoreCheck(input({ forceManual: true, modelConfidence: 100 }));
    expect(result.decision).toBe('queue');
    expect(result.gates.join(' ')).toMatch(/yourself/i);
  });

  it('holds rather than queues a gated result that also scored badly', () => {
    const result = scoreCheck(
      input({ sources: [source({ tier: 'social' })], coverage: 'inferred', modelConfidence: 40 }),
    );
    expect(result.decision).toBe('hold');
  });

  it('treats no_change as nothing to decide', () => {
    const result = scoreCheck(input({ proposedVerdict: 'no_change' }));
    expect(result.decision).not.toBe('auto_resolve');
    expect(result.gates).toHaveLength(1);
  });

  it('scores zero across the board when nothing was cited', () => {
    const result = scoreCheck(input({ sources: [], coverage: 'none' }));
    expect(result.score).toBe(0);
    expect(result.decision).toBe('hold');
    expect(result.gates.join(' ')).toMatch(/no sources/i);
  });
});
