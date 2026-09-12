import type { FeedFilter } from '../queries';

export interface ChipDef {
  label: string;
  filter: FeedFilter;
  count?: number;
}

function sameFilter(a: FeedFilter, b: FeedFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function FilterChips({
  chips,
  active,
  onChange,
}: {
  chips: ChipDef[];
  active: FeedFilter;
  onChange: (filter: FeedFilter) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1">
      <div className="flex w-max gap-2">
        {chips.map((chip) => {
          const isActive = sameFilter(chip.filter, active);
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => onChange(chip.filter)}
              aria-pressed={isActive}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] transition-colors ${
                isActive
                  ? 'border-ink bg-ink text-ground'
                  : 'border-rule text-ink-dim active:bg-surface-raised'
              }`}
            >
              {chip.label}
              {chip.count !== undefined && (
                <span className={isActive ? 'text-ground/70' : 'text-ink-faint'}>{chip.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
