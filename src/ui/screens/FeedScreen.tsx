import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeaderLink, Screen } from '../components/Screen';
import { Icon } from '../components/Icon';
import { FilterChips, type ChipDef } from '../components/FilterChips';
import { CATEGORIES, type Category } from '../../domain/types';
import { PredictionRow } from '../components/PredictionRow';
import { PullToRefresh } from '../components/PullToRefresh';
import { FeedOrderSheet } from '../components/FeedOrderSheet';
import { readFeedSort, writeFeedSort } from '../../lib/feedSortPref';
import { FEED_SORTS, type FeedSort } from '../../domain/feedSort';
import {
  awaitsUser,
  describePull,
  useClearCooldown,
  useCooldown,
  useFeed,
  usePull,
  useQuotaUsed,
  type FeedFilter,
} from '../queries';

const CHIP_DEFS: ChipDef[] = [
  { label: 'All', filter: { kind: 'all' } },
  { label: 'Open', filter: { kind: 'open' } },
  { label: 'Needs you', filter: { kind: 'needs_you' } },
  { label: 'Resolved', filter: { kind: 'resolved' } },
  { label: 'Late hits', filter: { kind: 'late' } },
  { label: 'Void', filter: { kind: 'void' } },
];

export function FeedScreen() {
  const [filter, setFilter] = useState<FeedFilter>({ kind: 'all' });
  const [sort, setSort] = useState<FeedSort>(readFeedSort);
  const [options, setOptions] = useState(false);
  const chooseSort = (next: FeedSort) => {
    writeFeedSort(next);
    setSort(next);
  };
  const all = useFeed({ kind: 'all' });
  const current = useFeed(filter, sort);
  const pull = usePull();
  const quota = useQuotaUsed();
  const { data: cooldown } = useCooldown();
  const clearHold = useClearCooldown();
  const [dismissed, setDismissed] = useState(false);

  const chips = useMemo<ChipDef[]>(() => {
    const items = all.data ?? [];
    const count = (f: FeedFilter): number => {
      switch (f.kind) {
        case 'all':
          return items.length;
        case 'open':
          return items.filter(
            (i) => i.prediction.status === 'open' || i.prediction.status === 'draft',
          ).length;
        case 'needs_you':
          return items.filter((i) =>
            awaitsUser(i.prediction, new Date(), Boolean(i.hasQueuedVerdict)),
          ).length;
        case 'resolved':
          return items.filter((i) =>
            ['hit', 'miss', 'partial', 'ambiguous'].includes(i.prediction.status),
          ).length;
        case 'late':
          return items.filter((i) => i.prediction.lateHitAt).length;
        case 'void':
          return items.filter((i) => i.prediction.status === 'void').length;
        default:
          return 0;
      }
    };
    const status = CHIP_DEFS.map((chip) => ({ ...chip, count: count(chip.filter) }));

    // Only categories that actually have something in them. A row of empty
    // categories is noise, and it grows as the taxonomy does.
    const byCategory = new Map<Category, number>();
    for (const item of items) {
      byCategory.set(item.prediction.category, (byCategory.get(item.prediction.category) ?? 0) + 1);
    }
    const categories: ChipDef[] = CATEGORIES.filter((c) => byCategory.has(c)).map((category) => ({
      label: category,
      filter: { kind: 'category', category },
      count: byCategory.get(category)!,
    }));

    return [...status, ...categories];
  }, [all.data]);

  const items = current.data ?? [];

  const check = () => {
    setDismissed(false);
    pull.mutate();
  };

  return (
    <Screen
      title="Mark My Words"
      scroll={false}
      actions={
        <>
          <button
            type="button"
            onClick={check}
            disabled={pull.isPending || Boolean(cooldown)}
            aria-label="Check what is due"
            title="Check what is due"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-dim active:bg-surface-raised disabled:opacity-40"
          >
            <Icon
              name="refresh"
              className={pull.isPending ? 'animate-spin [animation-duration:1.4s]' : undefined}
            />
          </button>
          <button
            type="button"
            onClick={() => setOptions(true)}
            aria-label="Order the feed"
            title="Order the feed"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-surface-raised ${
              sort !== 'heat' ? 'text-accent' : 'text-ink-dim'
            }`}
          >
            <Icon name="order" />
          </button>
          <HeaderLink to="/standings" label="Standings" icon="standings" />
          <HeaderLink to="/settings" label="Settings" icon="settings" />
        </>
      }
    >
      <PullToRefresh onRefresh={check} busy={pull.isPending} progress={pull.progress}>
        <div className="border-b border-rule px-4 py-3">
          <FilterChips chips={chips} active={filter} onChange={setFilter} />
        </div>

        {/* Says which order is in force, but only when it is not the default:
            the default needs no announcement, and the line is one more thing
            on a screen that is already a list. Tapping it opens the sheet;
            Reset drops back to heat without opening anything. */}
        {sort !== 'heat' && (
          <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface px-4 py-2">
            <button
              type="button"
              onClick={() => setOptions(true)}
              className="min-h-9 text-left text-[13px] text-ink-dim"
            >
              Ordered by{' '}
              <span className="text-accent">
                {FEED_SORTS.find((s) => s.value === sort)?.label.toLowerCase()}
              </span>
            </button>
            <button
              type="button"
              onClick={() => chooseSort('heat')}
              className="min-h-9 shrink-0 text-[12px] text-ink-faint underline-offset-2 active:underline"
            >
              Reset
            </button>
          </div>
        )}

        {cooldown && (
          <div className="border-b border-rule bg-attention/5 px-4 py-2.5">
            <p className="text-[13px] leading-relaxed text-attention">{cooldown.message}</p>
            <p className="mt-1 text-[12px] text-ink-faint">
              Checks are paused so the next one is not wasted. Drafting still works.
            </p>
            <button
              type="button"
              onClick={() => clearHold.mutate(undefined)}
              className="mt-2 rounded border border-rule min-h-11 px-3 text-[12px] text-ink-dim"
            >
              Try anyway
            </button>
          </div>
        )}

        {pull.data && !dismissed && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="block w-full border-b border-rule bg-surface px-4 py-2.5 text-left"
          >
            <span className="text-[13px] text-ink-dim">{describePull(pull.data)}</span>
            {quota.data?.limit != null && (
              <span className="mt-0.5 block text-[12px] text-ink-faint">
                {quota.data.used} of {quota.data.limit} checks used today
              </span>
            )}
          </button>
        )}

        {pull.error && !dismissed && (
          <p className="border-b border-rule bg-miss/5 px-4 py-2.5 text-[13px] text-miss">
            {pull.error.message}
          </p>
        )}

        {items.length === 0 ? (
          <EmptyState filterKind={filter.kind} />
        ) : (
          <ul className="pb-24">
            {items.map((item) => (
              <li key={item.prediction.id}>
                <PredictionRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </PullToRefresh>

      <FeedOrderSheet
        open={options}
        onClose={() => setOptions(false)}
        sort={sort}
        onSort={chooseSort}
      />

      <Link
        to="/new"
        aria-label="New prediction"
        className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-ink text-ground shadow-lg active:scale-95"
      >
        <Icon name="plus" size={26} strokeWidth={2} />
      </Link>
    </Screen>
  );
}

function EmptyState({ filterKind }: { filterKind: FeedFilter['kind'] }) {
  const copy: Record<string, string> = {
    category: 'Nothing in this category.',
    all: 'Nothing on the record yet. Catch someone saying it will happen.',
    open: 'No open predictions. Everything has been settled.',
    needs_you: 'Nothing waiting on you.',
    resolved: 'Nothing has resolved yet.',
    late: 'No late hits yet. This is where misses that eventually came true land.',
    void: 'Nothing voided.',
  };

  return (
    <div className="px-8 py-20 text-center">
      <p className="font-quote text-[21px] font-semibold text-ink-dim italic">
        {copy[filterKind] ?? 'Nothing here.'}
      </p>
      {/* Only on an empty ledger. A first launch is otherwise a sentence and a
          circle in the corner, and the circle is the only thing that does
          anything. Every other filter is empty because of the filter, so a
          button to add a prediction there would be answering the wrong
          question. */}
      {filterKind === 'all' && (
        <Link
          to="/new"
          className="mt-5 inline-flex min-h-11 items-center rounded-full border border-rule px-5 text-[14px] text-ink-dim active:bg-surface-raised"
        >
          Write one down
        </Link>
      )}
    </div>
  );
}
