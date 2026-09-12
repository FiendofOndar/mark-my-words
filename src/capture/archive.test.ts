import { describe, expect, it, vi } from 'vitest';
import { archiveSource, isHostileHost, type ArchiveHttp } from './archive';

const SNAPSHOT = 'https://web.archive.org/web/20260912120000/https://example.com/post';

function http(handler: (url: string) => { status: number; text?: string; finalUrl?: string }): ArchiveHttp {
  return {
    get: vi.fn(async (url: string) => {
      const result = handler(url);
      return { status: result.status, text: result.text ?? '', finalUrl: result.finalUrl ?? url };
    }),
  };
}

describe('hostile hosts', () => {
  it('recognizes the platforms that defeat archiving', () => {
    for (const url of [
      'https://www.instagram.com/p/abc',
      'https://tiktok.com/@x/video/1',
      'https://x.com/someone/status/1',
      'https://m.facebook.com/story',
    ]) {
      expect(isHostileHost(url)).toBe(true);
    }
  });

  it('leaves ordinary sources alone', () => {
    expect(isHostileHost('https://www.reddit.com/r/x/comments/y')).toBe(false);
    expect(isHostileHost('https://apnews.com/article/one')).toBe(false);
    expect(isHostileHost('not a url')).toBe(false);
  });
});

describe('archiving', () => {
  it('does nothing when there is no source url', async () => {
    const outcome = await archiveSource('   ', http(() => ({ status: 200 })));
    expect(outcome.status).toBe('not_applicable');
  });

  it('skips straight to a screenshot prompt on a hostile host', async () => {
    const client = http(() => ({ status: 200 }));
    const outcome = await archiveSource('https://www.instagram.com/p/abc', client);

    expect(outcome.status).toBe('failed');
    expect(outcome.note).toMatch(/screenshot/i);
    // No point spending three failed round trips first.
    expect(client.get).not.toHaveBeenCalled();
  });

  it('takes the Wayback snapshot when the save succeeds', async () => {
    const outcome = await archiveSource(
      'https://example.com/post',
      http(() => ({ status: 200, finalUrl: SNAPSHOT })),
    );
    expect(outcome).toMatchObject({ status: 'ok', archiveUrl: SNAPSHOT });
  });

  it('falls back to asking what Wayback already has', async () => {
    const outcome = await archiveSource(
      'https://example.com/post',
      http((url) => {
        if (url.includes('/save/')) return { status: 503 };
        if (url.includes('wayback/available')) {
          return {
            status: 200,
            text: JSON.stringify({
              archived_snapshots: { closest: { available: true, url: SNAPSHOT } },
            }),
          };
        }
        return { status: 404 };
      }),
    );
    expect(outcome).toMatchObject({ status: 'ok', archiveUrl: SNAPSHOT });
  });

  it('falls back to archive.today when Wayback has nothing', async () => {
    const outcome = await archiveSource(
      'https://example.com/post',
      http((url) => {
        if (url.includes('archive.ph')) {
          return { status: 200, finalUrl: 'https://archive.ph/AbC12' };
        }
        if (url.includes('wayback/available')) {
          return { status: 200, text: JSON.stringify({ archived_snapshots: {} }) };
        }
        return { status: 503 };
      }),
    );
    expect(outcome).toMatchObject({ status: 'ok', archiveUrl: 'https://archive.ph/AbC12' });
  });

  it('stays pending for a retry when everything fails', async () => {
    const outcome = await archiveSource(
      'https://example.com/post',
      http(() => ({ status: 503 })),
    );
    expect(outcome.status).toBe('pending');
    expect(outcome.note).toMatch(/try again/i);
  });

  it('survives a thrown request rather than failing the capture', async () => {
    const outcome = await archiveSource('https://example.com/post', {
      get: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(outcome.status).toBe('pending');
  });

  it('ignores an availability response that is not usable json', async () => {
    const outcome = await archiveSource(
      'https://example.com/post',
      http((url) =>
        url.includes('wayback/available')
          ? { status: 200, text: '<html>nope</html>' }
          : { status: 503 },
      ),
    );
    expect(outcome.status).toBe('pending');
  });
});
