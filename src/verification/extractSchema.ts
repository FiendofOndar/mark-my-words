import type { ExtractedPost } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A string as the model returned it, made safe to put in a form. A statement
 * once arrived on the device with a stray "002" and a foreign glyph stuck to
 * its last word, which no post contained; whatever the model emitted, control
 * characters, zero-width characters and a literal \uXXXX escape that survived
 * the JSON layer are never part of a quote.
 */
export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

const text = cleanText;

/**
 * The model's reading of a screenshot, made safe to show. A statement that
 * comes back with is_prediction false is dropped rather than shown, because
 * the whole point of the flag is that the words are not a claim.
 */
export function parseExtractedPost(raw: unknown): ExtractedPost {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const statement = text(r.statement);
  const isPrediction = r.is_prediction === true && statement !== null;
  const postedOn = text(r.posted_on);
  const dated = postedOn !== null && DATE_RE.test(postedOn);
  return {
    isPrediction,
    statement: isPrediction ? statement : null,
    author: text(r.author),
    platform: text(r.platform),
    postedOn: dated ? postedOn : null,
    // A posted_on that is not a full date ("Sep 9", "2y") is still worth
    // showing as the reason the date was not filled in.
    postedHint: text(r.posted_hint) ?? (postedOn && !dated ? postedOn : null),
    note: text(r.note),
  };
}
