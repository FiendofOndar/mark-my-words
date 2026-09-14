import type { ExtractedPost } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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
