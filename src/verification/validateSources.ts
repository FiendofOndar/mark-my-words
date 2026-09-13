/**
 * Checking that a cited source exists.
 *
 * This is the guardrail against the failure mode nothing else in the pipeline
 * can catch: a confident verdict resting on a plausible-looking URL that does
 * not exist. It used to go further and check whether the page carried the
 * quoted passage, then whether it carried the passage's figures and names.
 * Neither answer reached a decision: a real page whose wording has moved on
 * is still a real page, and the matcher could not tell drift from invention
 * by its own admission. The verdict is the model's; what the app can stand
 * behind is whether the link goes somewhere.
 */
import type { FetchStatus } from '../domain/types';
import type { CitedSource } from './types';

export type PageFetchOutcome =
  /**
   * `finalUrl` is where the fetch actually landed, which is not always where it
   * was pointed. Gemini's grounding returns redirect URLs on
   * vertexaisearch.cloud.google.com, and when the model cites those rather than
   * the publisher's own address, every judgement the app makes from a domain -
   * the tier, whether two sources are independent, whether the publisher name
   * can be true - was being made about Google.
   */
  | { kind: 'ok'; finalUrl?: string }
  /** The host answered; there is no page at that address. */
  | { kind: 'missing' }
  /** There is no such host. */
  | { kind: 'unreachable' }
  | { kind: 'blocked' };

export interface PageFetcher {
  /** Never throws. Every failure is reported as an outcome. */
  fetchPage(url: string): Promise<PageFetchOutcome>;
  /**
   * False when the platform cannot distinguish a dead URL from a blocked one,
   * which is the browser's situation: CORS and DNS failure look identical.
   */
  readonly canProveUnreachable: boolean;
}

export interface ValidatedSource extends CitedSource {
  fetchStatus: FetchStatus;
  fetchedAt: string;
}

export async function validateSources(
  sources: CitedSource[],
  fetcher: PageFetcher,
): Promise<ValidatedSource[]> {
  const fetchedAt = new Date().toISOString();

  return Promise.all(
    sources.map(async (source): Promise<ValidatedSource> => {
      const outcome = await fetcher.fetchPage(source.url);

      if (outcome.kind === 'blocked') return { ...source, fetchStatus: 'blocked', fetchedAt };
      if (outcome.kind === 'missing') return { ...source, fetchStatus: 'missing', fetchedAt };
      if (outcome.kind === 'unreachable') {
        return { ...source, fetchStatus: 'unreachable', fetchedAt };
      }

      return {
        ...source,
        // Follow the redirect through to whoever actually published this, so
        // the record, the link the user taps, and everything judged from the
        // domain all name the real source.
        url: outcome.finalUrl?.trim() || source.url,
        fetchStatus: 'ok',
        fetchedAt,
      };
    }),
  );
}

/**
 * The browser implementation.
 *
 * A cross-origin fetch that fails throws the same TypeError whether the host
 * does not exist or the host simply refused the browser. Since those cannot be
 * told apart here, every failure is reported as blocked. Reporting them as
 * unreachable would flag real citations as invented, which is the one mistake
 * this layer exists to prevent. The native build (Capacitor HTTP) sees real
 * status codes and can tell the difference.
 */
export class BrowserPageFetcher implements PageFetcher {
  readonly canProveUnreachable = false;

  constructor(private timeoutMs = 15_000) {}

  async fetchPage(url: string): Promise<PageFetchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (response.status === 404 || response.status === 410) return { kind: 'missing' };
      if (!response.ok) return { kind: 'blocked' };
      return { kind: 'ok', finalUrl: response.url };
    } catch {
      return { kind: 'blocked' };
    } finally {
      clearTimeout(timer);
    }
  }
}
