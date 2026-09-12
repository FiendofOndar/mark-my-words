import { describe, expect, it } from 'vitest';
import {
  normalizeForMatch,
  pageContainsQuote,
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
