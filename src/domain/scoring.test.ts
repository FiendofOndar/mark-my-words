import { describe, expect, it } from 'vitest';
import { MIN_SCORED_TO_RANK, formatRate, formatRecord, tallyRecord } from './scoring';
import { makePrediction } from './fixtures';

const of = (status: Parameters<typeof makePrediction>[0] extends never ? never : string, extra = {}) =>
  makePrediction({ status: status as never, ...extra });

describe('author record', () => {
  it('scores hits, misses and partials only', () => {
    const r = tallyRecord([
      of('hit'),
      of('hit'),
      of('miss'),
      of('partial'),
      of('ambiguous'),
      of('void'),
      of('open'),
      of('draft'),
    ]);
    expect(r).toMatchObject({ hit: 2, miss: 1, partial: 1, ambiguous: 1, voided: 1, open: 2 });
    expect(r.scored).toBe(4);
  });

  it('counts a partial as half a hit', () => {
    const r = tallyRecord([of('hit'), of('miss'), of('partial'), of('miss')]);
    expect(r.rate).toBeCloseTo((1 + 0.5) / 4);
  });

  it('excludes retroactive entries from the math but not from the count of late hits', () => {
    const r = tallyRecord([
      of('hit'),
      of('hit', { isRetroactive: true }),
      of('miss', { isRetroactive: true }),
    ]);
    expect(r.scored).toBe(1);
    expect(r.rate).toBe(1);
  });

  it('ignores deleted predictions', () => {
    const r = tallyRecord([of('hit'), of('miss', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    expect(r.scored).toBe(1);
  });

  it('counts late hits separately from the verdict', () => {
    const r = tallyRecord([of('miss', { lateHitAt: '2027-01-01T00:00:00.000Z' })]);
    expect(r.miss).toBe(1);
    expect(r.lateHits).toBe(1);
    expect(r.rate).toBe(0);
  });

  it('returns a null rate when nothing has scored', () => {
    const r = tallyRecord([of('open'), of('ambiguous')]);
    expect(r.rate).toBeNull();
    expect(formatRate(r)).toBe('--');
  });

  it('only ranks an author with enough volume', () => {
    const few = tallyRecord(Array.from({ length: MIN_SCORED_TO_RANK - 1 }, () => of('hit')));
    const enough = tallyRecord(Array.from({ length: MIN_SCORED_TO_RANK }, () => of('hit')));
    expect(few.ranked).toBe(false);
    expect(enough.ranked).toBe(true);
  });

  it('formats the record with partials only when there are any', () => {
    expect(formatRecord(tallyRecord([of('hit'), of('miss')]))).toBe('1-1');
    expect(formatRecord(tallyRecord([of('hit'), of('miss'), of('partial')]))).toBe('1-1-1');
  });
});
