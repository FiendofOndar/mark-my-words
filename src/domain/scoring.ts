/**
 * Hit-rate math for authors.
 *
 * Only hit, miss and partial land in the denominator. Ambiguous and void are
 * excluded because they say nothing about the caller's judgment, and
 * retroactive entries are excluded entirely because backfilled predictions are
 * cherry-picked by construction.
 */
import type { Prediction } from './types';

export interface AuthorRecord {
  hit: number;
  miss: number;
  partial: number;
  ambiguous: number;
  voided: number;
  open: number;
  lateHits: number;
  /** hit + miss + partial, excluding retroactive entries */
  scored: number;
  /** null when nothing has been scored yet */
  rate: number | null;
  /** true once there is enough volume to appear in the ranked standings */
  ranked: boolean;
}

export const MIN_SCORED_TO_RANK = 5;

export function emptyRecord(): AuthorRecord {
  return {
    hit: 0,
    miss: 0,
    partial: 0,
    ambiguous: 0,
    voided: 0,
    open: 0,
    lateHits: 0,
    scored: 0,
    rate: null,
    ranked: false,
  };
}

export function tallyRecord(predictions: Prediction[]): AuthorRecord {
  const r = emptyRecord();

  for (const p of predictions) {
    if (p.deletedAt) continue;
    if (p.lateHitAt) r.lateHits += 1;

    if (p.status === 'open' || p.status === 'draft') {
      r.open += 1;
      continue;
    }
    if (p.status === 'ambiguous') {
      r.ambiguous += 1;
      continue;
    }
    if (p.status === 'void') {
      r.voided += 1;
      continue;
    }

    // Retroactive entries show on the author's page but never score.
    if (p.isRetroactive) continue;

    if (p.status === 'hit') r.hit += 1;
    else if (p.status === 'miss') r.miss += 1;
    else if (p.status === 'partial') r.partial += 1;
  }

  r.scored = r.hit + r.miss + r.partial;
  r.rate = r.scored === 0 ? null : (r.hit + 0.5 * r.partial) / r.scored;
  r.ranked = r.scored >= MIN_SCORED_TO_RANK;
  return r;
}

/** "8-4-1" in hit-miss-partial order, the way a standings table reads. */
export function formatRecord(r: AuthorRecord): string {
  return r.partial > 0 ? `${r.hit}-${r.miss}-${r.partial}` : `${r.hit}-${r.miss}`;
}

export function formatRate(r: AuthorRecord): string {
  return r.rate === null ? '--' : `${Math.round(r.rate * 100)}%`;
}

/**
 * The big number to put in front of someone's name.
 *
 * A hit rate is only shown once the record can carry one. An author 1-0
 * displayed as "100%" is exactly the cherry-picked number the five-call
 * threshold exists to refuse, and it was being printed on the author screen,
 * in the standings, and on the card that leaves the app and gets shown to the
 * person it is about. Three places, one rule, so the rule lives here.
 */
export function formatHeadline(r: AuthorRecord): string {
  return r.ranked ? formatRate(r) : formatRecord(r);
}
