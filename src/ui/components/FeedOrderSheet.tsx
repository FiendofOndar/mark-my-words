import { Modal } from './Modal';
import { FEED_SORTS, type FeedSort } from '../../domain/feedSort';
import { secondaryButton } from './Field';

/**
 * The feed's order, in a sheet. Filters live in the chip strip and nowhere
 * else: the first version repeated them here and the owner asked for one or
 * the other, and the chips carry counts and stay in view.
 */
export function FeedOrderSheet({
  open,
  onClose,
  sort,
  onSort,
}: {
  open: boolean;
  onClose: () => void;
  sort: FeedSort;
  onSort: (sort: FeedSort) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} align="bottom">
      <p className="label">Order the feed</p>
      <ul className="mt-2 divide-y divide-rule">
        {FEED_SORTS.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              role="radio"
              aria-checked={option.value === sort}
              onClick={() => {
                onSort(option.value);
                onClose();
              }}
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
      <button type="button" onClick={onClose} className={`${secondaryButton} mt-3 min-h-11 w-full px-4 text-[13px]`}>
        Done
      </button>
    </Modal>
  );
}
