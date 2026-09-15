import { Modal } from './Modal';
import type { Category } from '../../domain/types';
import { secondaryButton } from './Field';

export interface TopicOption {
  category: Category;
  count: number;
}

/**
 * What the feed is about, in a sheet. Status chips stay in the strip because
 * they are the ones tapped every day; topics sat beside them as more chips
 * of the same shape, and Politics next to Needs you read as one list of
 * unrelated things. A topic narrows whatever status is chosen rather than
 * replacing it.
 */
export function FeedTopicSheet({
  open,
  onClose,
  topics,
  total,
  topic,
  onTopic,
}: {
  open: boolean;
  onClose: () => void;
  topics: TopicOption[];
  total: number;
  topic: Category | null;
  onTopic: (topic: Category | null) => void;
}) {
  const rows: { value: Category | null; label: string; count: number }[] = [
    { value: null, label: 'All topics', count: total },
    ...topics.map((t) => ({ value: t.category, label: t.category, count: t.count })),
  ];
  return (
    <Modal open={open} onClose={onClose} align="bottom">
      <p className="label">Topic</p>
      <ul className="mt-2 divide-y divide-rule">
        {rows.map((row) => (
          <li key={row.label}>
            <button
              type="button"
              role="radio"
              aria-checked={row.value === topic}
              onClick={() => {
                onTopic(row.value);
                onClose();
              }}
              className="flex min-h-12 w-full items-center gap-3 py-2 text-left active:bg-surface-raised"
            >
              <span
                aria-hidden
                className={`h-4 w-4 shrink-0 rounded-full border ${
                  row.value === topic ? 'border-accent bg-accent' : 'border-rule'
                }`}
              />
              <span className="flex-1 font-display text-[15px] tracking-wide text-ink">{row.label}</span>
              <span className="text-[13px] text-ink-faint">{row.count}</span>
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
