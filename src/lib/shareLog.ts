/**
 * What happened the last time something was shared into the app.
 *
 * The share path cannot be exercised in a browser and its failures are
 * silent by nature (the app simply opens on the feed), so the one line that
 * says what arrived and what was done with it is the whole diagnostic.
 * Settings shows it. Kept out of the database, which Settings exports.
 */
const KEY = 'mmw-last-share';

export interface ShareRecord {
  at: string;
  what: string;
}

export function recordShare(what: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), what }));
  } catch {
    /* storage unavailable; the note is a convenience */
  }
}

const EXTRACT_KEY = 'mmw-last-extract';
const EXTRACT_LIMIT = 4000;

/**
 * What the model said about the last screenshot, verbatim. A statement that
 * came back with a stray tail of characters once had nothing to diagnose it
 * from; the response is the only place the answer could be.
 */
export function recordExtraction(rawText: string): void {
  try {
    localStorage.setItem(EXTRACT_KEY, rawText.slice(0, EXTRACT_LIMIT));
  } catch {
    /* storage unavailable */
  }
}

export function readLastExtraction(): string | null {
  try {
    return localStorage.getItem(EXTRACT_KEY);
  } catch {
    return null;
  }
}

export function readLastShare(): ShareRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShareRecord>;
    if (typeof parsed.at !== 'string' || typeof parsed.what !== 'string') return null;
    return { at: parsed.at, what: parsed.what };
  } catch {
    return null;
  }
}
