import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeaderLink, Screen } from '../components/Screen';
import { FilterChips, type ChipDef } from '../components/FilterChips';
import { PredictionRow } from '../components/PredictionRow';
import { awaitsUser, useFeed, type FeedFilter } from '../queries';

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
          return items.filter((i) => awaitsUser(i.prediction)).length;
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

  return (
    <Screen
      title="Mark My Words"
      actions={
        <>
          <HeaderLink to="/standings" label="Standings" glyph="▤" />
          <HeaderLink to="/settings" label="Settings" glyph="⚙" />
        </>
      }
    >
      <div className="border-b border-rule px-4 py-3">
        <FilterChips chips={chips} active={filter} onChange={setFilter} />
      </div>

      {items.length === 0 ? (
        <EmptyState filterKind={filter.kind} />
      ) : (
        // Bottom padding keeps the last row clear of the floating add button.
        <ul className="pb-24">
          {items.map((item) => (
            <li key={item.prediction.id}>
              <PredictionRow item={item} />
            </li>
          ))}
        </ul>
      )}

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
