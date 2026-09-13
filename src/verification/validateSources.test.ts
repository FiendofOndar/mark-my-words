import { describe, expect, it } from 'vitest';
import {
  normalizeForMatch,
  distinctiveTokens,
  pageContainsQuote,
  pageSupportsQuote,
  stripHtml,
  validateSources,
  type PageFetchOutcome,
  type PageFetcher,
} from './validateSources';
import type { CitedSource } from './types';

function source(overrides: Partial<CitedSource> = {}): CitedSource {
  return {
    url: 'https://apnews.com/article/one',
    title: 'Cardinals win',
    publisher: 'AP',
    publishedAt: '2026-11-02',
    quotedText: 'The Cardinals took the series in six games on Sunday night.',
    tier: 'major_outlet',
    ...overrides,
  };
}

class FakeFetcher implements PageFetcher {
  readonly canProveUnreachable = true;
  constructor(private outcomes: Record<string, PageFetchOutcome>) {}
  async fetchPage(url: string): Promise<PageFetchOutcome> {
    return this.outcomes[url] ?? { kind: 'unreachable' };
  }
}

describe('stripHtml', () => {
  it('drops tags and the contents of script and style', () => {
    const text = stripHtml(
      '<p>Hello <b>world</b></p><script>var x = "secret";</script><style>.a{}</style>',
    );
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('.a{}');
  });

  it('decodes the entities that show up in quoted passages', () => {
    expect(stripHtml('it&#39;s &quot;on&quot; &amp; done')).toBe('it\'s "on" & done');
  });
});

describe('normalizeForMatch', () => {
  it('flattens smart quotes, dashes and whitespace', () => {
    expect(normalizeForMatch('  The “Cardinals” — won \n\n it’s over ')).toBe(
      'the "cardinals" - won it\'s over',
    );
  });
});

describe('pageContainsQuote', () => {
  const page =
    'Late Sunday in St. Louis, the Cardinals took the series in six games on Sunday night, ending a long drought.';

  it('matches an exact quote', () => {
    expect(pageContainsQuote(page, 'The Cardinals took the series in six games')).toBe(true);
  });

  it('matches across typographic differences', () => {
    expect(
      pageContainsQuote(
        'The team said it’s “the best season” they have had — ever.',
        'it\'s "the best season" they have had - ever',
      ),
    ).toBe(true);
  });

  it('matches a quote trimmed with an ellipsis', () => {
    expect(
      pageContainsQuote(page, 'the Cardinals took the series ... on Sunday night'),
    ).toBe(true);
  });

  it('rejects a passage the page does not contain', () => {
    expect(
      pageContainsQuote(page, 'The Cardinals were eliminated in the division series in four games'),
    ).toBe(false);
  });

  it('will not match a short quote fuzzily', () => {
    // Every word is on the page, but five words is not distinctive enough to
    // treat a scattered match as a real citation.
    expect(pageContainsQuote(page, 'Cardinals drought games series Sunday')).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(pageContainsQuote(page, '   ')).toBe(false);
  });
});

describe('distinctiveTokens', () => {
  it('keeps the figures and the names and drops the phrasing', () => {
    expect(
      distinctiveTokens('The high in Anacortes reached 71 degrees on September 5.').sort(),
    ).toEqual(['5', '71', 'anacortes', 'sep']);
  });

  it('does not spend a token on a capitalised article', () => {
    expect(distinctiveTokens('The Eagles won.')).toEqual(['eagles']);
  });

  it('finds nothing distinctive in a sentence made of phrasing', () => {
    expect(distinctiveTokens('it was a very close game in the end')).toEqual([]);
  });

  it('reads an ISO date as the three facts it is', () => {
    expect(distinctiveTokens('Played on 2025-02-09').sort()).toEqual(['2025', '9', 'feb', 'played']);
  });
});

describe('pageSupportsQuote', () => {
  /*
   * The case the verbatim matcher kept failing: the model writes a sentence
   * from a search snippet, the page says the same thing in its own words, and
   * the two share almost no phrasing.
   */
  it('matches a page that carries the facts in different words', () => {
    const page = 'Sept 5 climate report for Anacortes, WA. Maximum temperature 71F.';
    const quote = 'The high in Anacortes reached 71 degrees on September 5.';
    expect(pageContainsQuote(page, quote)).toBe(false);
    expect(pageSupportsQuote(page, quote)).toBe(true);
  });

  it('refuses a page missing one of the figures', () => {
    const page = 'Sept 5 climate report for Anacortes, WA. Maximum temperature 64F.';
    expect(pageSupportsQuote(page, 'The high in Anacortes reached 71 degrees on September 5.')).toBe(
      false,
    );
  });

  // The stricter location rule the prompt asks for, enforced here too: the
  // right number at the wrong place is how a Sea-Tac reading got used for
  // Anacortes.
  it('refuses the right number at the wrong place', () => {
    const page = 'Sept 5 climate report for Seattle-Tacoma. Maximum temperature 71F.';
    expect(pageSupportsQuote(page, 'The high in Anacortes reached 71 degrees on September 5.')).toBe(
      false,
    );
  });

  it('will not match on a single token, however specific', () => {
    expect(pageSupportsQuote('The Eagles are in it again.', 'The Eagles won.')).toBe(false);
  });

  /*
   * The shape the app will really be handed. A National Weather Service
   * climate report is all caps, abbreviates the month, glues the unit to the
   * reading and ends the line on a period, and none of that is a disagreement
   * with the sentence the model wrote.
   */
  it('reads a climate report written the way the weather service writes them', () => {
    const page =
      'NATIONAL WEATHER SERVICE SEATTLE WA. ANACORTES WA. SEPT 5 2026. MAXIMUM TEMPERATURE 71F.';
    const quote = 'The high in Anacortes on September 5, 2026 reached 71 degrees.';
    expect(pageContainsQuote(page, quote)).toBe(false);
    expect(pageSupportsQuote(page, quote)).toBe(true);
  });

  it('refuses the right reading from the wrong year', () => {
    expect(
      pageSupportsQuote(
        'NATIONAL WEATHER SERVICE. ANACORTES WA. SEPT 5 2025. MAXIMUM TEMPERATURE 71F.',
        'The high in Anacortes on September 5, 2026 reached 71 degrees.',
      ),
    ).toBe(false);
  });

  it('refuses a scoreline that does not match', () => {
    expect(
      pageSupportsQuote(
        'Super Bowl LIX: Philadelphia Eagles beat Kansas City Chiefs 24-21.',
        'The Philadelphia Eagles defeated the Kansas City Chiefs 40-22 in Super Bowl LIX.',
      ),
    ).toBe(false);
  });

  /*
   * What a fabricated citation actually serves: a live host and a page with
   * none of the facts on it. This is the case the whole layer exists for, so
   * loosening the matcher must not loosen this.
   */
  it('refuses a section front that happens to be on the right site', () => {
    expect(
      pageSupportsQuote(
        'NFL.com | Latest news, scores, schedules, standings, video and fantasy football.',
        'The Philadelphia Eagles defeated the Kansas City Chiefs 40-22 in Super Bowl LIX.',
      ),
    ).toBe(false);
  });

  it('refuses a consent wall', () => {
    expect(
      pageSupportsQuote(
        'We use cookies. By continuing you agree to our privacy policy. Enable JavaScript to continue.',
        'The high in Anacortes on September 5, 2026 reached 71 degrees.',
      ),
    ).toBe(false);
  });
});

describe('validateSources', () => {
  it('marks a source ok when the page carries the quote', async () => {
    const s = source();
    const result = await validateSources(
      [s],
      new FakeFetcher({ [s.url]: { kind: 'ok', text: `<p>${s.quotedText}</p>` } }),
    );
    expect(result[0]!.fetchStatus).toBe('ok');
    expect(result[0]!.fetchedAt).toBeTruthy();
  });

  it('marks a source quote_not_found when the page exists but says otherwise', async () => {
    const s = source();
    const result = await validateSources(
      [s],
      new FakeFetcher({ [s.url]: { kind: 'ok', text: '<p>Something entirely different.</p>' } }),
    );
    expect(result[0]!.fetchStatus).toBe('quote_not_found');
  });

  it('marks a source facts_found when the page carries the figures but not the sentence', async () => {
    const s = source({
      quotedText: 'The high in Anacortes reached 71 degrees on September 5.',
    });
    const result = await validateSources(
      [s],
      new FakeFetcher({
        [s.url]: {
          kind: 'ok',
          text: '<p>Sept 5 climate report for Anacortes, WA. Maximum temperature 71F.</p>',
        },
      }),
    );
    expect(result[0]!.fetchStatus).toBe('facts_found');
  });

  it('marks a source unreachable when the fetcher says so', async () => {
    const result = await validateSources([source()], new FakeFetcher({}));
    expect(result[0]!.fetchStatus).toBe('unreachable');
  });

  it('marks a source blocked rather than unreachable when it was refused', async () => {
    const s = source();
    const result = await validateSources([s], new FakeFetcher({ [s.url]: { kind: 'blocked' } }));
    expect(result[0]!.fetchStatus).toBe('blocked');
  });

  it('validates every source, not just the first', async () => {
    const a = source({ url: 'https://a.com/1' });
    const b = source({ url: 'https://b.com/1' });
    const result = await validateSources(
      [a, b],
      new FakeFetcher({
        [a.url]: { kind: 'ok', text: a.quotedText },
        [b.url]: { kind: 'blocked' },
      }),
    );
    expect(result.map((r) => r.fetchStatus)).toEqual(['ok', 'blocked']);
  });
});

describe('grounding redirects', () => {
  it('records the publisher the redirect landed on, not the redirect', async () => {
    // The real one. Gemini cited two different outlets, both as
    // vertexaisearch.cloud.google.com/grounding-api-redirect/... links, so the
    // app judged both by Google's domain: two sources collapsed to one, an NWS
    // climate record scored as an unknown site, and the resulting "only one
    // independent source" gate blocked a verdict the model was 98% sure of.
    const fetcher: PageFetcher = {
      canProveUnreachable: true,
      fetchPage: async () => ({
        kind: 'ok',
        text: 'the thing definitively happened on Tuesday in front of everyone',
        finalUrl: 'https://www.weather.gov/sew/climate-report',
      }),
    };

    const [validated] = await validateSources(
      [
        {
          url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123',
          title: null,
          publisher: 'National Weather Service',
          publishedAt: '2026-09-11',
          quotedText: 'the thing definitively happened on Tuesday in front of everyone',
          tier: 'primary',
        },
      ],
      fetcher,
    );

    expect(validated!.url).toBe('https://www.weather.gov/sew/climate-report');
    expect(validated!.fetchStatus).toBe('ok');
  });

  it('keeps the cited URL when the fetch never landed anywhere', async () => {
    const fetcher: PageFetcher = {
      canProveUnreachable: true,
      fetchPage: async () => ({ kind: 'blocked' }),
    };
    const [validated] = await validateSources(
      [
        {
          url: 'https://example.com/a',
          title: null,
          publisher: 'Someone',
          publishedAt: null,
          quotedText: 'x',
          tier: 'secondary',
        },
      ],
      fetcher,
    );
    expect(validated!.url).toBe('https://example.com/a');
  });
});
