/**
 * The record and the standings, for any ledger. The rule that matters most:
 * a percentage is never printed for someone who has not earned a rank.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MIN_SCORED_TO_RANK, compareStandings, formatHeadline, formatRecord, tallyRecord } from './scoring';
import { predictions, shuffled } from './arbitraries';

describe('tally', () => {
  it('adds up: scored is hit + miss + partial, rate is between 0 and 1, rank needs the minimum', () => {
    fc.assert(
      fc.property(predictions(20), (ps) => {
        const r = tallyRecord(ps);
        expect(r.scored).toBe(r.hit + r.miss + r.partial);
        if (r.scored === 0) expect(r.rate).toBeNull();
        else {
          expect(r.rate).toBeGreaterThanOrEqual(0);
          expect(r.rate).toBeLessThanOrEqual(1);
        }
        expect(r.ranked).toBe(r.scored >= MIN_SCORED_TO_RANK);
      }),
    );
  });

  it('a retroactive or deleted entry never moves the score', () => {
    fc.assert(
      fc.property(predictions(12), predictions(6), (ps, extra) => {
        const before = tallyRecord(ps);
        const tainted = extra.map((p, i) => (i % 2 === 0 ? { ...p, isRetroactive: true } : { ...p, deletedAt: '2026-01-01T00:00:00.000Z' }));
        const after = tallyRecord([...ps, ...tainted]);
        expect([after.hit, after.miss, after.partial, after.scored, after.rate]).toEqual([
          before.hit,
          before.miss,
          before.partial,
          before.scored,
          before.rate,
        ]);
      }),
    );
  });

  it('does not care what order the ledger is read in', () => {
    fc.assert(
      fc.property(predictions(12).chain((ps) => fc.tuple(fc.constant(ps), shuffled(ps))), ([a, b]) => {
        expect(tallyRecord(b)).toEqual(tallyRecord(a));
      }),
    );
  });

  it('never prints a percentage for an unranked author', () => {
    fc.assert(
      fc.property(predictions(20), (ps) => {
        const r = tallyRecord(ps);
        const headline = formatHeadline(r);
        if (!r.ranked) return headline === formatRecord(r) && !headline.includes('%');
        return headline.endsWith('%');
      }),
    );
  });
});

describe('standings order', () => {
  const record = predictions(12).map((ps) => tallyRecord(ps));
  const named = fc.tuple(record, fc.constantFrom('Ada', 'Bo', 'Cy')).map(([r, name]) => ({ name, record: r }));

  it('is a consistent total order', () => {
    fc.assert(
      fc.property(named, named, named, (a, b, c) => {
        expect(Math.sign(compareStandings(a, b)) + Math.sign(compareStandings(b, a))).toBe(0);
        if (compareStandings(a, b) <= 0 && compareStandings(b, c) <= 0) {
          expect(compareStandings(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('every ranked author sits above every unranked one', () => {
    fc.assert(
      fc.property(named, named, (a, b) => {
        if (a.record.ranked && !b.record.ranked) return compareStandings(a, b) < 0;
        return true;
      }),
    );
  });

  it('never orders two unranked authors by their rate', () => {
    fc.assert(
      fc.property(named, named, (a, b) => {
        if (a.record.ranked || b.record.ranked) return true;
        if (a.record.scored !== b.record.scored || a.record.open !== b.record.open) return true;
        // Same volume: only the name may decide, however the rates differ.
        return Math.sign(compareStandings(a, b)) + 0 === Math.sign(a.name.localeCompare(b.name)) + 0;
      }),
    );
  });
});
