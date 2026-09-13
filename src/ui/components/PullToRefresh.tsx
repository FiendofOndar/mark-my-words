import { useRef, useState, type ReactNode } from 'react';
import { describeProgress, type PullProgress } from '../../verification/runPull';

const TRIGGER_PX = 72;
const MAX_PULL = 110;

/**
 * Pull down to check. This gesture is the app's entire scheduler, so it gets
 * a real threshold and a real resting state rather than firing on any drag.
 */
export function PullToRefresh({
  onRefresh,
  busy,
  progress,
  children,
}: {
  onRefresh: () => void;
  busy: boolean;
  /** How far through the pull is, when there is more than one thing to check. */
  progress?: PullProgress | null;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const armed = pull >= TRIGGER_PX;

  const onTouchStart = (e: React.TouchEvent) => {
    // Only start a pull from a resting scroll position, or this fights the list.
    if ((scroller.current?.scrollTop ?? 0) > 0 || busy) return;
    startY.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const delta = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    // Resistance, so the sheet does not track the finger one to one.
    setPull(Math.min(MAX_PULL, delta * 0.5));
  };

  const onTouchEnd = () => {
    if (armed && !busy) onRefresh();
    startY.current = null;
    setPull(0);
  };

  const height = busy ? TRIGGER_PX : pull;

  return (
    <div
      ref={scroller}
      className="h-full overflow-y-auto"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        className="flex items-end justify-center overflow-hidden transition-[height] duration-150"
        style={{ height }}
        aria-hidden={height === 0}
      >
        <span className="pb-3 font-sans text-[15px] tracking-wide text-ink-faint uppercase">
          {busy
            ? describeProgress(progress ?? null)
            : armed
              ? 'Release to check'
              : 'Pull to check'}
        </span>
      </div>
      {children}
    </div>
  );
}
