import { Modal } from './Modal';
import type { ChipDef } from './FilterChips';
import type { FeedFilter } from '../queries';
import { FEED_SORTS, type FeedSort } from '../../domain/feedSort';
import { secondaryButton } from './Field';

function sameFilter(a: FeedFilter, b: FeedFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The feed's order and filter in one sheet, for a ledger too long for the
 * chip strip alone. The chips stay: they are the quick version of the same
 * filters, and this is the complete one.
 */
export function FeedOptionsSheet({
  open,
  onClose,
  sort,
  onSort,
  chips,
  filter,
  onFilter,
}: {
  open: boolean;
  onClose: () => void;
  sort: FeedSort;
  onSort: (sort: FeedSort) => void;
  chips: ChipDef[];
  filter: FeedFilter;
  onFilter: (filter: FeedFilter) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} align="bottom">
      <div className="max-h-[70vh] overflow-y-auto">
        <p className="label">Order</p>
        <ul className="mt-2 divide-y divide-rule">
          {FEED_SORTS.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="radio"
                aria-checked={option.value === sort}
                onClick={() => onSort(option.value)}
                className="flex min-h-12 w-full items-center gap-3 py-2 text-left active:bg-surface-raised"
              >
                <span
                  aria-hidden
                  className={`h-4 w-4 shrink-0 rounded-full border ${
                    option.value === sort ? 'border-accent bg-accent' : 'border-rule'
                  }`}
                />
                <span>
                  <span className="block font-display text-[15px] tracking-wide text-ink">{option.label}</span>
                  <span className="block text-[12px] text-ink-faint">{option.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="label mt-5">Show</p>
        <ul className="mt-2 divide-y divide-rule">
          {chips.map((chip) => {
            const active = sameFilter(chip.filter, filter);
            return (
              <li key={chip.label}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    onFilter(chip.filter);
                    onClose();
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left active:bg-surface-raised"
                >
                  <span className={`font-display text-[15px] tracking-wide ${active ? 'text-ink' : 'text-ink-dim'}`}>
                    {chip.label}
                  </span>
                  {chip.count !== undefined && (
                    <span className="font-mono text-[12px] text-ink-faint">{chip.count}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <button type="button" onClick={onClose} className={`${secondaryButton} mt-3 min-h-11 w-full px-4 text-[13px]`}>
        Done
      </button>
    </Modal>
  );
}
