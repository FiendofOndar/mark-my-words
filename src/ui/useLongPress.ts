import { useRef, type PointerEvent } from 'react';

const HOLD_MS = 450;
const SLOP_PX = 10;

/**
 * Press-and-hold on a touch target that is also a link.
 *
 * Pointer events rather than touch events, so a mouse can do it too. The
 * click that follows a completed hold is swallowed, or the link would open
 * the moment the finger lifted off the menu that just appeared.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (!origin.current) return;
      const dx = e.clientX - origin.current.x;
      const dy = e.clientY - origin.current.y;
      // A scroll is not a hold.
      if (Math.hypot(dx, dy) > SLOP_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}
