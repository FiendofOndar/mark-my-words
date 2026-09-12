import { useCallback, useEffect, useRef, useState } from 'react';
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
  const scroller = useRef<HTMLDivElement>(null);
  const activeChip = useRef<HTMLButtonElement>(null);

  // Which edges have more chips past them. Without this the strip just ends in a
  // chip sliced down the middle, which reads as a layout bug rather than as
  // something you can scroll. The fade is only drawn on a side that can move.
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  }, []);

  // Measured by observer rather than on render, because the first render is the
  // wrong moment: the display font is still loading, the chips are narrower
  // than they will be, and the strip measures as not overflowing at all. The
  // right-hand fade was missing until the first scroll because of exactly that.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  // A filter can be chosen from somewhere other than a tap, and a chip that is
  // selected off-screen leaves the strip looking like nothing happened.
  useEffect(() => {
    activeChip.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <div
      className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      ref={scroller}
      onScroll={measure}
      style={{
        maskImage: maskFor(edges),
        WebkitMaskImage: maskFor(edges),
      }}
    >
      <div className="flex w-max gap-2">
        {chips.map((chip) => {
          const isActive = sameFilter(chip.filter, active);
          return (
            <button
              key={chip.label}
              ref={isActive ? activeChip : undefined}
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

function maskFor({ left, right }: { left: boolean; right: boolean }): string | undefined {
  if (!left && !right) return undefined;
  const start = left ? 'transparent 0, black 24px' : 'black 0';
  const end = right ? 'black calc(100% - 24px), transparent 100%' : 'black 100%';
  return `linear-gradient(to right, ${start}, ${end})`;
}
