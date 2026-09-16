/**
 * The feed order must be a function of the data alone. Two loads of the same
 * ledger once listed the same rows in different orders, which is what the
 * id tiebreak fixed; these keep it fixed for every sort.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { heatScore, sortByHeat } from './heat';
import { FEED_SORTS, sortFeed, type FeedSort, type SortInput } from './feedSort';
import { effectiveDeadline } from './prediction';
import { instant, prediction, shuffled } from './arbitraries';
import { makePrediction } from './fixtures';

const sortInput: fc.Arbitrary<SortInput> = fc.record({
  prediction,
  hasQueuedVerdict: fc.boolean(),
  trendChanged: fc.boolean(),
  newEvidence: fc.boolean(),
  author: fc.record({ displayName: fc.constantFrom('Ada', 'ada', 'Bo', 'Cy', 'Émile', 'Zed') }),
});
const feed = fc.array(sortInput, { maxLength: 12 });
const feedSort: fc.Arbitrary<FeedSort> = fc.constantFrom(...FEED_SORTS.map((s) => s.value));
const ids = (items: SortInput[]) => items.map((i) => i.prediction.id);

describe('heat', () => {
  it('a deleted row is colder than anything alive', () => {
    fc.assert(
      fc.property(sortInput, instant, (input, now) => {
        const heat = heatScore(input, now);
        return input.prediction.deletedAt ? heat === -1 : heat >= 0;
      }),
    );
  });

  it('an open claim never cools as its deadline approaches', () => {
    fc.assert(
      fc.property(instant, fc.integer({ min: -200, max: 400 }), fc.integer({ min: -200, max: 400 }), (now, d1, d2) => {
        const [far, near] = d1 >= d2 ? [d1, d2] : [d2, d1];
        const at = (days: number) => ({
          prediction: makePrediction({ resolutionDate: new Date(now.getTime() + days * 86_400_000).toISOString() }),
        });
        return heatScore(at(near), now) >= heatScore(at(far), now);
      }),
    );
  });

  it('sorts to the same order from any starting order, and is a permutation', () => {
    fc.assert(
      fc.property(feed.chain((f) => fc.tuple(fc.constant(f), shuffled(f))), instant, ([a, b], now) => {
        const sortedA = sortByHeat(a, now);
        const sortedB = sortByHeat(b, now);
        expect(ids(sortedB as SortInput[])).toEqual(ids(sortedA as SortInput[]));
        expect(ids(sortedA as SortInput[]).sort()).toEqual(ids(a).sort());
      }),
    );
  });

  it('never lists a cooler row above a hotter one', () => {
    fc.assert(
      fc.property(feed, instant, (f, now) => {
        const sorted = sortByHeat(f, now);
        for (let i = 1; i < sorted.length; i += 1) {
          if (heatScore(sorted[i]!, now) > heatScore(sorted[i - 1]!, now)) return false;
        }
        return true;
      }),
    );
  });
});

describe('feed sort', () => {
  it('is a permutation that does not depend on arrival order, for every sort', () => {
    fc.assert(
      fc.property(feed.chain((f) => fc.tuple(fc.constant(f), shuffled(f))), feedSort, instant, ([a, b], sort, now) => {
        const sortedA = sortFeed(a, sort, now);
        const sortedB = sortFeed(b, sort, now);
        expect(ids(sortedB)).toEqual(ids(sortedA));
        expect(ids(sortedA).sort()).toEqual(ids(a).sort());
      }),
    );
  });

  it('pinned rows come first, in the order they were pinned', () => {
    fc.assert(
      fc.property(feed, feedSort, instant, (f, sort, now) => {
        const sorted = sortFeed(f, sort, now);
        const pinnedCount = f.filter((i) => i.prediction.pinnedAt !== null).length;
        const head = sorted.slice(0, pinnedCount);
        const tail = sorted.slice(pinnedCount);
        expect(head.every((i) => i.prediction.pinnedAt !== null)).toBe(true);
        expect(tail.every((i) => i.prediction.pinnedAt === null)).toBe(true);
        for (let i = 1; i < head.length; i += 1) {
          expect(new Date(head[i]!.prediction.pinnedAt!).getTime()).toBeGreaterThanOrEqual(
            new Date(head[i - 1]!.prediction.pinnedAt!).getTime(),
          );
        }
      }),
    );
  });

  it('by deadline runs soonest first with open-ended claims at the end', () => {
    fc.assert(
      fc.property(feed, instant, (f, now) => {
        const unpinned = sortFeed(f, 'deadline', now).filter((i) => i.prediction.pinnedAt === null);
        const ms = unpinned.map((i) => {
          const d = effectiveDeadline(i.prediction);
          return d ? new Date(d).getTime() : null;
        });
        let seenNull = false;
        for (let i = 0; i < ms.length; i += 1) {
          if (ms[i] === null) seenNull = true;
          else if (seenNull) return false;
          else if (i > 0 && ms[i - 1] !== null && ms[i]! < ms[i - 1]!) return false;
        }
        return true;
      }),
    );
  });

  it('newest and oldest are each other in reverse, by statement date', () => {
    fc.assert(
      fc.property(feed, instant, (f, now) => {
        const unpinned = f.filter((i) => i.prediction.pinnedAt === null);
        const newest = sortFeed(unpinned, 'newest', now).map((i) => i.prediction.statementDate);
        const oldest = sortFeed(unpinned, 'oldest', now).map((i) => i.prediction.statementDate);
        for (let i = 1; i < newest.length; i += 1) {
          if (newest[i]! > newest[i - 1]!) return false;
          if (oldest[i]! < oldest[i - 1]!) return false;
        }
        return true;
      }),
    );
  });

  it('by author is alphabetical without regard to case or accent', () => {
    fc.assert(
      fc.property(feed, instant, (f, now) => {
        const names = sortFeed(f, 'author', now)
          .filter((i) => i.prediction.pinnedAt === null)
          .map((i) => i.author.displayName);
        for (let i = 1; i < names.length; i += 1) {
          if (names[i]!.localeCompare(names[i - 1]!, undefined, { sensitivity: 'base' }) < 0) return false;
        }
        return true;
      }),
    );
  });
});
