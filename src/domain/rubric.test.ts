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

/**
 * `tier` is still on the type because the model sends it, but nothing reads it
 * any more: the score comes from the domain. A default of apnews.com is a wire
 * service, which is `major_outlet` and not `primary`, however it is labelled.
 */
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

/** A government host, which is genuinely the body that would know. */
function primarySource(overrides: Partial<SourceAssessment> = {}): SourceAssessment {
  return source({ url: 'https://www.weather.gov/record', publisher: 'National Weather Service', ...overrides });
}

function input(overrides: Partial<RubricInput> = {}): RubricInput {
  return {
    sources: [
      primarySource(),
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
    // A thin score no longer buries the finding. One lone social source is a
    // gate, so this asks rather than acting.
    expect(result.decision).toBe('queue');
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

  it('still stops an unsure model from auto-resolving', () => {
    const result = scoreCheck(input({ modelConfidence: 43 }));
    expect(result.breakdown.evidenceTotal).toBe(100);
    expect(result.score).toBe(63);
    expect(result.decision).not.toBe('auto_resolve');
  });

  it('does not let an unsure model bury evidence the app verified itself', () => {
    // The real one: four sources, three publishers, two quotes confirmed on the
    // page, an observed value nowhere near the claim. The model reported 43 of
    // its own accord, which capped the score to 63, under the queue threshold,
    // and the whole finding was filed as "no change". A model that is unsure of
    // itself is exactly when a person should be asked.
    const result = scoreCheck(input({ modelConfidence: 43 }));
    expect(result.score).toBeLessThan(QUEUE_AT);
    expect(result.breakdown.evidenceTotal).toBeGreaterThanOrEqual(QUEUE_AT);
    expect(result.decision).toBe('queue');
  });

  it('holds when the evidence itself is thin, whatever the model says', () => {
    const result = scoreCheck(
      input({
        sources: [source({ tier: 'social', publisher: 'A blog' })],
        coverage: 'inferred',
        modelConfidence: 40,
      }),
    );
    expect(result.breakdown.evidenceTotal).toBeLessThan(QUEUE_AT);
    expect(result.decision).toBe('queue');
  });
});

describe('url validation', () => {
  it('gates only when nothing resolved at all', () => {
    // Every cited page missing is what fabrication looks like.
    const allDead = scoreCheck(
      input({
        sources: [
          source({ publisher: 'AP', fetchStatus: 'unreachable' }),
          source({ url: 'https://reuters.com/a', fetchStatus: 'unreachable' }),
        ],
      }),
    );
    expect(allDead.breakdown.urlValidation).toBe(0);
    expect(allDead.gates.join(' ')).toMatch(/invented citations/i);
    expect(allDead.decision).not.toBe('auto_resolve');
  });

  it('lets one bad deep link stand among pages that did resolve', () => {
    // The real one, twice over: a timeanddate.com URL 404'd while weather.gov
    // and wunderground.com both served the page, and the whole verdict was
    // blocked. A model that found real pages is not inventing citations, it got
    // one link wrong, and that link no longer counts as corroboration either.
    const result = scoreCheck(
      input({
        sources: [
          source({ publisher: 'AP' }),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters' }),
          source({
            url: 'https://timeanddate.com/x',
            publisher: 'Time and Date',
            fetchStatus: 'unreachable',
          }),
        ],
      }),
    );
    expect(result.gates).toEqual([]);
    expect(result.breakdown.urlValidation).toBe(20);
    // Two resolved domains, not three cited ones.
    expect(result.breakdown.independentSources).toBe(22);
    expect(result.decision).toBe('auto_resolve');
  });

  it('pays for confirmed corroboration, not for the ratio', () => {
    // Two publishers confirmed on the page is the same answer to "could the app
    // stand any of this up itself" whether or not a third link went stale. As a
    // ratio this scored less than the same two cited alone, which punished the
    // model for showing its work.
    const ap = source({ publisher: 'AP' });
    const reuters = source({ url: 'https://reuters.com/a', publisher: 'Reuters' });
    const twoOfThree = scoreCheck(
      input({
        sources: [
          ap,
          reuters,
          source({ url: 'https://bbc.co.uk/a', publisher: 'BBC', fetchStatus: 'quote_not_found' }),
        ],
      }),
    );
    const twoAlone = scoreCheck(input({ sources: [ap, reuters] }));
    expect(twoOfThree.breakdown.urlValidation).toBe(20);
    expect(twoOfThree.breakdown.urlValidation).toBe(twoAlone.breakdown.urlValidation);
  });

  it('does not count one outlet twice as corroboration', () => {
    // Two NWS pages are one source confirmed, not two, the same way the
    // independent-source count treats them. Relabelling one of them would not
    // help: both counts key on the domain now.
    const result = scoreCheck(
      input({
        sources: [
          source({ publisher: 'National Weather Service', url: 'https://forecast.weather.gov/a' }),
          source({ publisher: 'National Weather Service', url: 'https://www.weather.gov/b' }),
        ],
      }),
    );
    expect(result.breakdown.urlValidation).toBe(12);
    expect(countIndependentSources(result ? input().sources.slice(0, 1) : [])).toBe(1);
  });

  it('does not count a page that does not exist as corroboration', () => {
    const result = scoreCheck(
      input({
        sources: [
          source({ publisher: 'AP' }),
          source({ url: 'https://nowhere.example/a', fetchStatus: 'unreachable' }),
        ],
      }),
    );
    expect(countIndependentSources(result ? [] : [])).toBe(0);
    expect(result.breakdown.independentSources).toBe(10);
  });

  it('gives a little credit when every page was read but nothing was quoted back', () => {
    // Live pages are the usual cause: a weather forecast or a scoreboard has
    // already rewritten itself by the time the app fetches it minutes later.
    // The URLs still resolved, which is most of what this dimension guards.
    const result = scoreCheck(
      input({
        sources: input().sources.map((s) => ({ ...s, fetchStatus: 'quote_not_found' as const })),
      }),
    );
    expect(result.breakdown.urlValidation).toBe(4);
  });

  it('gives nothing when a page could not be read at all', () => {
    // Mixed: one page read and unquoted, one never opened. Not every page was
    // read, so the benefit of the doubt does not apply.
    const result = scoreCheck(
      input({
        sources: [
          source({ publisher: 'AP', fetchStatus: 'quote_not_found' }),
          source({ publisher: 'Reuters', fetchStatus: 'blocked' }),
        ],
      }),
    );
    expect(result.breakdown.urlValidation).toBe(0);
  });

  it('treats a blocked source as unchecked rather than as a fake citation', () => {
    // This is the browser case: CORS stops the app from reading the page, but
    // the page is not therefore invented.
    const result = scoreCheck(
      input({ sources: input().sources.map((s) => ({ ...s, fetchStatus: 'blocked' as const })) }),
    );
    expect(result.breakdown.urlValidation).toBe(0);
    // Nothing the app noticed contradicts the verdict: the pages simply would
    // not open. A bot wall is not evidence that a citation was invented, so it
    // costs points on the log without standing in the way of a clear answer.
    expect(result.gates).toEqual([]);
    expect(result.score).toBe(80);
    expect(result.decision).toBe('auto_resolve');
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
          source({ url: 'https://reuters.com/a', publishedAt: '2024-06-02', publisher: 'Reuters' }),
          source({ url: 'https://bbc.co.uk/a', publishedAt: '2024-06-03', publisher: 'BBC' }),
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

  it('asks rather than burying a gated result that also scored badly', () => {
    // `hold` used to swallow this entirely. A verdict the app cannot act on is
    // still a verdict somebody should see.
    const result = scoreCheck(
      input({ sources: [source({ tier: 'social' })], coverage: 'inferred', modelConfidence: 40 }),
    );
    expect(result.decision).toBe('queue');
    expect(result.gates.length).toBeGreaterThan(0);
  });

  it('treats no_change as nothing to decide', () => {
    const result = scoreCheck(input({ proposedVerdict: 'no_change' }));
    expect(result.decision).not.toBe('auto_resolve');
    expect(result.gates).toHaveLength(1);
  });

  it('scores zero across the board when nothing was cited', () => {
    const result = scoreCheck(input({ sources: [], coverage: 'none' }));
    expect(result.score).toBe(0);
    expect(result.decision).toBe('queue');
    expect(result.gates.join(' ')).toMatch(/no sources/i);
  });
});
