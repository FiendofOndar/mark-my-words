/**
 * Getting an image out of the app and into somebody else's hands.
 *
 * Phase 0.6 swaps this for Capacitor Filesystem + Share, which puts the card
 * into the Android share sheet. The browser can only offer a download, and the
 * Web Share API when the platform supports sharing files.
 */
export interface ImageSharer {
  readonly id: string;
  share(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded'>;
}

export class BrowserImageSharer implements ImageSharer {
  readonly id = 'browser';

  async share(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded'> {
    const file = new File([blob], filename, { type: blob.type });

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return 'shared';
      } catch (err) {
        // A cancelled share is not a failure, and must not fall through to a
        // surprise download the user did not ask for.
        if ((err as Error).name === 'AbortError') return 'shared';
      }
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  }
}

export function receiptFilename(subject: string, kind: 'receipt' | 'scorecard'): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `mark-my-words-${kind}-${slug || 'card'}.png`;
}
