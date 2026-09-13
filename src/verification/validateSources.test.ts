import { describe, expect, it } from 'vitest';
import { validateSources, type PageFetchOutcome, type PageFetcher } from './validateSources';
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

describe('validateSources', () => {
  it('marks a source ok when the link goes somewhere', async () => {
    const s = source();
    const result = await validateSources([s], new FakeFetcher({ [s.url]: { kind: 'ok' } }));
    expect(result[0]!.fetchStatus).toBe('ok');
    expect(result[0]!.fetchedAt).toBeTruthy();
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

  it('checks every source, not just the first', async () => {
    const a = source({ url: 'https://a.com/1' });
    const b = source({ url: 'https://b.com/1' });
    const result = await validateSources(
      [a, b],
      new FakeFetcher({ [a.url]: { kind: 'ok' }, [b.url]: { kind: 'blocked' } }),
    );
    expect(result.map((r) => r.fetchStatus)).toEqual(['ok', 'blocked']);
  });

  it('keeps the quoted passage as the model gave it', async () => {
    // The quote is shown on the row as the citation. Nothing checks it against
    // the page any more, and nothing should rewrite it either.
    const s = source();
    const [validated] = await validateSources([s], new FakeFetcher({ [s.url]: { kind: 'ok' } }));
    expect(validated!.quotedText).toBe(s.quotedText);
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
        finalUrl: 'https://www.weather.gov/sew/climate-report',
      }),
    };

    const [validated] = await validateSources(
      [
        source({
          url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123',
          publisher: 'National Weather Service',
        }),
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
    const [validated] = await validateSources([source({ url: 'https://example.com/a' })], fetcher);
    expect(validated!.url).toBe('https://example.com/a');
  });
});
