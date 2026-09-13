/**
 * Checking that a cited source exists and actually says what it was quoted as
 * saying. This is the guardrail against the most common failure mode: a
 * confident verdict resting on a plausible-looking URL that does not exist.
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
   * can be true - was being made about Google. Two different outlets counted as
   * one source and a National Weather Service record scored as an unknown site.
   */
  | { kind: 'ok'; text: string; finalUrl?: string }
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

/** Minimum words before a quote is allowed to match fuzzily. */
const FUZZY_MIN_WORDS = 6;
const FUZZY_THRESHOLD = 0.9;

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/** Typography drifts between what a model quotes and what a page serves. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Punctuation-only tokens are dropped, so an ellipsis standing in for trimmed
 * text does not count against the match it was meant to enable.
 */
function words(text: string): string[] {
  return text.split(/[^a-z0-9$%.'-]+/i).filter((w) => /[a-z0-9]/i.test(w));
}

/**
 * Exact containment first. Failing that, a quote long enough to be distinctive
 * passes if almost all of its words appear on the page, which survives
 * ellipses, smart quotes and minor trimming without matching on coincidence.
 */
export function pageContainsQuote(pageText: string, quote: string): boolean {
  const page = normalizeForMatch(pageText);
  const needle = normalizeForMatch(quote);
  if (!needle) return false;
  if (page.includes(needle)) return true;

  const needleWords = words(needle);
  if (needleWords.length < FUZZY_MIN_WORDS) return false;

  const pageWords = new Set(words(page));
  const hits = needleWords.filter((w) => pageWords.has(w)).length;
  return hits / needleWords.length >= FUZZY_THRESHOLD;
}

export async function validateSources(
  sources: CitedSource[],
  fetcher: PageFetcher,
): Promise<ValidatedSource[]> {
  const fetchedAt = new Date().toISOString();

  return Promise.all(
    sources.map(async (source): Promise<ValidatedSource> => {
      const outcome = await fetcher.fetchPage(source.url);

      if (outcome.kind === 'blocked') {
        return { ...source, fetchStatus: 'blocked', fetchedAt };
      }
      if (outcome.kind === 'unreachable') {
        return { ...source, fetchStatus: 'unreachable', fetchedAt };
      }

      const text = stripHtml(outcome.text);
      return {
        ...source,
        // Follow the redirect through to whoever actually published this, so
        // the record, the link the user taps, and everything scored from the
        // domain all name the real source.
        url: outcome.finalUrl?.trim() || source.url,
        fetchStatus: pageContainsQuote(text, source.quotedText) ? 'ok' : 'quote_not_found',
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
 * this layer exists to prevent. The native build (Capacitor HTTP, phase 0.6)
 * sees real status codes and can tell the difference.
 */
export class BrowserPageFetcher implements PageFetcher {
  readonly canProveUnreachable = false;

  constructor(private timeoutMs = 15_000) {}

  async fetchPage(url: string): Promise<PageFetchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (response.status === 404 || response.status === 410) return { kind: 'unreachable' };
      if (!response.ok) return { kind: 'blocked' };
      return { kind: 'ok', text: await response.text(), finalUrl: response.url };
    } catch {
      return { kind: 'blocked' };
    } finally {
      clearTimeout(timer);
    }
  }
}
