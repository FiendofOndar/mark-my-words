import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeaderLink, Screen } from '../components/Screen';
import { FilterChips, type ChipDef } from '../components/FilterChips';
import { PredictionRow } from '../components/PredictionRow';
import { PullToRefresh } from '../components/PullToRefresh';
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
  const all = useFeed({ kind: 'all' });
  const current = useFeed(filter);
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
    return CHIP_DEFS.map((chip) => ({ ...chip, count: count(chip.filter) }));
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
            className="shrink-0 rounded-full px-2 py-1 text-lg text-ink-dim active:bg-surface-raised disabled:opacity-40"
          >
            {pull.isPending ? '…' : '⟳'}
          </button>
          <HeaderLink to="/standings" label="Standings" glyph="▤" />
          <HeaderLink to="/settings" label="Settings" glyph="⚙" />
        </>
      }
    >
      <PullToRefresh onRefresh={check} busy={pull.isPending}>
        <div className="border-b border-rule px-4 py-3">
          <FilterChips chips={chips} active={filter} onChange={setFilter} />
        </div>

        {cooldown && (
          <div className="border-b border-rule bg-partial/5 px-4 py-2.5">
            <p className="text-[13px] text-partial">{cooldown.message}</p>
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

      <Link
        to="/new"
        aria-label="New prediction"
        className="fixed right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-ink text-3xl leading-none text-ground shadow-lg active:scale-95"
      >
        <span className="-mt-1">+</span>
      </Link>
    </Screen>
  );
}

function EmptyState({ filterKind }: { filterKind: FeedFilter['kind'] }) {
  const copy: Record<string, string> = {
    all: 'Nothing on the record yet. Catch someone saying it will happen.',
    open: 'No open predictions. Everything has been settled.',
    needs_you: 'Nothing waiting on you.',
    resolved: 'Nothing has resolved yet.',
    late: 'No late hits yet. This is where misses that eventually came true land.',
    void: 'Nothing voided.',
  };

  return (
    <div className="px-8 py-20 text-center">
      <p className="font-display text-lg text-ink-dim italic">
        {copy[filterKind] ?? 'Nothing here.'}
      </p>
    </div>
  );
}
