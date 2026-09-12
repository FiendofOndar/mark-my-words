import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toBlob } from 'html-to-image';
import { CARD_HEIGHT, CARD_WIDTH } from './ReceiptCard';
import { BrowserImageSharer, receiptFilename } from './share';

const sharer = new BrowserImageSharer();

let fontCss: Promise<string> | null = null;

/** Fetched once, then reused for every card. */
function loadFontCss(): Promise<string> {
  fontCss ??= fetch('/fonts/fonts.css')
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  return fontCss;
}

export type ReceiptState = 'idle' | 'rendering' | 'shared' | 'downloaded' | 'failed';

/**
 * Rasterize a card and hand it off.
 *
 * The card is mounted offscreen at full size rather than scaled from the
 * on-screen layout, so the output does not depend on the viewport it was
 * generated from.
 */
export function useReceipt() {
  const [state, setState] = useState<ReceiptState>('idle');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const generate = useCallback(
    async (card: React.ReactElement, subject: string, kind: 'receipt' | 'scorecard') => {
      if (busy.current) return;
      busy.current = true;
      setState('rendering');
      setError(null);

      const host = document.createElement('div');
      host.style.cssText = `position:fixed;left:-99999px;top:0;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;`;
      document.body.appendChild(host);
      const root = createRoot(host);

      try {
        // A concurrent render may not have committed by the time we rasterize,
        // which produces a card containing nothing but its background.
        flushSync(() => root.render(card));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await document.fonts?.ready;

        // The card itself, not the offscreen host. html-to-image clones the
        // node into an SVG foreignObject, and a `position: fixed` root is taken
        // out of flow there and rasterizes to nothing but the background.
        const target = host.firstElementChild as HTMLElement | null;
        if (!target) throw new Error('The card did not render.');

        const blob = await toBlob(target, {
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          pixelRatio: 1,
          backgroundColor: '#111014',
          // The faces are served from this origin, so html-to-image can read
          // and inline them. Without that the card rasterizes in a fallback
          // face, because an SVG foreignObject cannot reach an external font.
          fontEmbedCSS: await loadFontCss(),
        });
        if (!blob) throw new Error('The card came back empty.');

        setState(await sharer.share(blob, receiptFilename(subject, kind), subject));
      } catch (err) {
        setError((err as Error).message);
        setState('failed');
      } finally {
        root.unmount();
        host.remove();
        busy.current = false;
      }
    },
    [],
  );

  return { state, error, generate };
}
