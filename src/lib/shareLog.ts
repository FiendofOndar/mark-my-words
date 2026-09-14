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
