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

/**
 * Capitalised words that carry no identity, so a quote opening with "The" does
 * not spend one of its two required tokens on the article.
 */
const COMMON_CAPS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'he', 'her', 'his', 'i', 'if', 'in',
  'is', 'it', 'its', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their', 'they',
  'this', 'to', 'we', 'were', 'what', 'when', 'which', 'while', 'who', 'with',
]);

/**
 * Every spelling of a month collapses to three letters.
 *
 * A date is the token this matcher most often turns on, and it is also the one
 * written four different ways on four different pages: a National Weather
 * Service climate report says "Sept 5", the model writes "September 5", and
 * comparing the two as strings says they disagree.
 *
 * Spelled out rather than prefix-matched, because "may" is a prefix of "mayor"
 * and "mar" of "March Madness".
 */
const MONTH_FORMS: Record<string, string> = {
  jan: 'jan', january: 'jan',
  feb: 'feb', february: 'feb',
  mar: 'mar', march: 'mar',
  apr: 'apr', april: 'apr',
  may: 'may',
  jun: 'jun', june: 'jun',
  jul: 'jul', july: 'jul',
  aug: 'aug', august: 'aug',
  sep: 'sep', sept: 'sep', september: 'sep',
  oct: 'oct', october: 'oct',
  nov: 'nov', november: 'nov',
  dec: 'dec', december: 'dec',
};

const MONTH_ORDER = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function canonical(token: string): string {
  return MONTH_FORMS[token] ?? token;
}

/**
 * Everything on the page a quote token is allowed to match against.
 *
 * Beyond the words themselves this carries the digit runs inside them, because
 * a page writes a measurement as one token and a sentence writes it as two:
 * "71F" and "71 degrees" are the same reading, and a plain word index finds
 * "71" in only one of them.
 */
function matchIndex(pageText: string): Set<string> {
  const index = new Set<string>();
  for (const raw of words(normalizeForMatch(pageText))) {
    // `words` keeps a trailing period, because it also has to keep the one in
    // "71.4". A page ending a sentence on "Sept 5 2026." therefore offered the
    // token "2026." and matched nothing.
    const word = raw.replace(/^[.'-]+|[.'-]+$/g, '');
    if (!word) continue;
    index.add(canonical(word));
    if (/\d/.test(word) && /[a-z]/.test(word)) {
      for (const run of word.match(/\d+(?:\.\d+)?/g) ?? []) index.add(run);
    }
  }
  return index;
}

/**
 * The load-bearing part of a quote: the figures, dates and names.
 *
 * Everything else is phrasing, and phrasing is exactly what drifts between a
 * model writing from a search snippet and the page as it is served minutes
 * later. "The high in Anacortes reached 71 degrees on September 5" and "Sept 5
 * climate report for Anacortes: maximum temperature 71F" share almost no
 * wording and assert the same fact, and the fact is made of Anacortes, Sept, 5
 * and 71.
 *
 * Deliberately case-sensitive on the quote side. That is where proper nouns
 * announce themselves, and it is thrown away by `normalizeForMatch`.
 */
export function distinctiveTokens(quote: string): string[] {
  const cleaned = quote
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-');

  const out = new Set<string>();
  for (const raw of cleaned.split(/[^A-Za-z0-9$%.'-]+/)) {
    const token = raw.replace(/^[.'-]+|[.'-]+$/g, '');
    if (!token) continue;

    // An ISO date is one token to a string comparison and three facts to a
    // reader. No page outside this app writes "2025-02-09".
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
    if (iso) {
      out.add(iso[1]!);
      const month = MONTH_ORDER[Number(iso[2]) - 1];
      if (month) out.add(month);
      out.add(String(Number(iso[3])));
      continue;
    }

    if (/\d/.test(token)) {
      out.add(token.toLowerCase());
      continue;
    }
    if (token.length < 3) continue;
    if (!/^[A-Z]/.test(token)) continue;
    const lower = token.toLowerCase();
    if (COMMON_CAPS.has(lower)) continue;
    out.add(canonical(lower));
  }
  return [...out];
}

/** Below this, "all tokens present" is coincidence rather than corroboration. */
const MIN_DISTINCTIVE_TOKENS = 2;

function tokenOnPage(token: string, index: Set<string>): boolean {
  if (index.has(token)) return true;
  // "71F" quoted against a page that wrote "71 degrees".
  const runs = token.match(/\d+(?:\.\d+)?/g);
  if (!runs || !/[a-z]/.test(token)) return false;
  return runs.every((run) => index.has(run));
}

/**
 * Whether the page carries the quote's facts, if not its sentence.
 *
 * This is the fabrication guardrail doing its actual job. A URL invented to
 * look plausible does not serve a page containing the specific figures and
 * names the verdict rests on; a real page whose wording has moved on does. The
 * verbatim matcher could not tell those two apart and called both a failure,
 * which is why the evidence panel spent four consecutive real checks reporting
 * that nothing had been confirmed while the verdict itself was right.
 *
 * Every token has to be there. A partial hit is how a page about the wrong
 * place or the wrong year looks, and those are the two mistakes that have
 * actually shown up in real checks.
 */
export function pageSupportsQuote(pageText: string, quote: string): boolean {
  const tokens = distinctiveTokens(quote);
  if (tokens.length < MIN_DISTINCTIVE_TOKENS) return false;

  const index = matchIndex(pageText);
  return tokens.every((t) => tokenOnPage(t, index));
}

function classifyMatch(pageText: string, quote: string): FetchStatus {
  if (pageContainsQuote(pageText, quote)) return 'ok';
  if (pageSupportsQuote(pageText, quote)) return 'facts_found';
  return 'quote_not_found';
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
        fetchStatus: classifyMatch(text, source.quotedText),
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
