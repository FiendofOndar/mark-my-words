import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { getFontEmbedCSS, toBlob } from 'html-to-image';
import { CARD_HEIGHT, CARD_WIDTH } from './ReceiptCard';
import { BrowserImageSharer, receiptFilename, type ImageSharer } from './share';
import { CapacitorImageSharer } from '../platform/CapacitorImageSharer';
import { isNative } from '../platform';

const sharer: ImageSharer = isNative() ? new CapacitorImageSharer() : new BrowserImageSharer();

/**
 * The card's faces, inlined as data URLs so the SVG the card is drawn through
 * can use them.
 *
 * Handing html-to-image the stylesheet text itself is not enough: it inserts
 * `fontEmbedCSS` verbatim, and a `url(./face.woff2)` cannot be fetched from
 * inside an SVG image, so every card silently rasterized in a system face.
 * That went unnoticed while the fallback was a similar width; the condensed
 * display face made the stamp overflow its own box.
 *
 * Not cached: the library only embeds the families the given node uses, so a
 * result kept from one card could be missing a face the next one needs. The
 * files come from this origin and the browser cache; the cost is a few base64
 * conversions per card.
 */
async function loadFontCss(target: HTMLElement): Promise<string> {
  try {
    return await getFontEmbedCSS(target);
  } catch {
    return '';
  }
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
          fontEmbedCSS: await loadFontCss(target),
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
