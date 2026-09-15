import { isFeedSort, type FeedSort } from '../domain/feedSort';

const KEY = 'mmw-feed-sort';

/** A per-device display preference, like the theme: localStorage, not the database. */
export function readFeedSort(): FeedSort {
  try {
    const stored = localStorage.getItem(KEY);
    return isFeedSort(stored) ? stored : 'heat';
  } catch {
    return 'heat';
  }
}

export function writeFeedSort(sort: FeedSort): void {
  try {
    localStorage.setItem(KEY, sort);
  } catch {
    /* the preference simply will not stick */
  }
}
