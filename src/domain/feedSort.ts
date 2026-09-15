import type { HeatInput } from './heat';
import { sortByHeat } from './heat';
import { effectiveDeadline } from './prediction';

/**
 * How the feed is ordered.
 *
 * Heat is the default and the product rule: what needs attention is on top.
 * The others exist for a long ledger, where someone wants to read it as a
 * list rather than as a queue. A per-device display preference, like the
 * theme; never stored in the database.
 */
export type FeedSort = 'heat' | 'deadline' | 'newest' | 'oldest' | 'author';

export const FEED_SORTS: { value: FeedSort; label: string; hint: string }[] = [
  { value: 'heat', label: 'What needs you', hint: 'Overdue and waiting first, then by deadline.' },
  { value: 'deadline', label: 'Deadline, soonest first', hint: 'Open-ended claims at the end.' },
  { value: 'newest', label: 'Newest first', hint: 'By the date it was said.' },
  { value: 'oldest', label: 'Oldest first', hint: 'By the date it was said.' },
  { value: 'author', label: 'By author', hint: 'A to Z, then what needs you.' },
];

export function isFeedSort(value: unknown): value is FeedSort {
  return FEED_SORTS.some((s) => s.value === value);
}

export interface SortInput extends HeatInput {
  author: { displayName: string };
}

/**
 * Pinned rows first, in the order they were pinned, then the chosen order.
 *
 * Pinning is the one hand-placed thing in the feed. The owner asked for
 * drag-to-reorder; a hand-sorted ledger would let a bad call be buried under
 * a good one, which is the thing the heat sort exists to prevent, so a pin
 * lifts a few rows above the rule without replacing it.
 */
export function sortFeed<T extends SortInput>(items: T[], sort: FeedSort, now: Date = new Date()): T[] {
  const pinned = items
    .filter((i) => i.prediction.pinnedAt !== null)
    .sort((a, b) => compareIso(a.prediction.pinnedAt!, b.prediction.pinnedAt!) || byId(a, b));
  const rest = items.filter((i) => i.prediction.pinnedAt === null);
  return [...pinned, ...order(rest, sort, now)];
}

function order<T extends SortInput>(items: T[], sort: FeedSort, now: Date): T[] {
  switch (sort) {
    case 'heat':
      return sortByHeat(items, now) as T[];
    case 'deadline': {
      const heat = sortByHeat(items, now) as T[];
      return [...heat].sort((a, b) => {
        const da = deadlineMs(a);
        const db = deadlineMs(b);
        if (da === db) return 0; // keep the heat order between equals
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    }
    case 'newest':
      return stable(items, (a, b) => compareIso(b.prediction.statementDate, a.prediction.statementDate));
    case 'oldest':
      return stable(items, (a, b) => compareIso(a.prediction.statementDate, b.prediction.statementDate));
    case 'author': {
      const heat = sortByHeat(items, now) as T[];
      return [...heat].sort((a, b) =>
        a.author.displayName.localeCompare(b.author.displayName, undefined, { sensitivity: 'base' }),
      );
    }
  }
}

/** A sort with the id as the last word, so two equal rows never swap between renders. */
function stable<T extends SortInput>(items: T[], compare: (a: T, b: T) => number): T[] {
  return [...items].sort((a, b) => compare(a, b) || byId(a, b));
}

function byId(a: SortInput, b: SortInput): number {
  return a.prediction.id < b.prediction.id ? -1 : a.prediction.id > b.prediction.id ? 1 : 0;
}

function compareIso(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

function deadlineMs(input: SortInput): number | null {
  const deadline = effectiveDeadline(input.prediction);
  return deadline ? new Date(deadline).getTime() : null;
}
