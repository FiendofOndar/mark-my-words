import { CapacitorHttp } from '@capacitor/core';
import type { PageFetchOutcome, PageFetcher } from '../verification/validateSources';

/**
 * Source validation on device.
 *
 * Requests go through native code rather than the WebView, so there is no CORS
 * and real status codes come back. That is what makes the difference between a
 * dead link and a blocked one legible, which is what lets a check auto-resolve
 * at all.
 */
export class CapacitorPageFetcher implements PageFetcher {
  readonly canProveUnreachable = true;

  constructor(private timeoutMs = 20_000) {}

  async fetchPage(url: string): Promise<PageFetchOutcome> {
    try {
      const response = await CapacitorHttp.get({
        url,
        readTimeout: this.timeoutMs,
        connectTimeout: this.timeoutMs,
        responseType: 'text',
        headers: {
          // Some outlets serve a stub to anything that does not look like a
          // browser, which would read as "the quote is not on the page".
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      const status = response.status;
      // The host answered. A 404 on a real publisher is a deep link the model
      // got wrong, not an invented outlet; an invented outlet has no host.
      if (status === 404 || status === 410) return { kind: 'missing' };
      if (status === 401 || status === 403 || status === 429) return { kind: 'blocked' };
      if (status < 200 || status >= 400) return { kind: 'blocked' };

      // Where it landed, not where it was pointed: grounding hands back
      // redirect URLs, and a citation has to be recorded against its publisher.
      return { kind: 'ok', finalUrl: response.url };
    } catch (err) {
      // A DNS failure is the signature of an invented citation; a timeout is
      // not, so only the former is reported as unreachable.
      const message = String((err as Error)?.message ?? '').toLowerCase();
      const dead = /unknown host|name not resolved|no address associated|unresolved/.test(message);
      return dead ? { kind: 'unreachable' } : { kind: 'blocked' };
    }
  }
}
