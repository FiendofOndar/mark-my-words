import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ImageSharer } from '../receipts/share';

/**
 * Android share sheet. The card is written to cache first, because Share wants
 * a file URI rather than bytes.
 */
export class CapacitorImageSharer implements ImageSharer {
  readonly id = 'capacitor';

  async share(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded'> {
    const path = `receipts/${filename}`;

    await Filesystem.writeFile({
      path,
      data: await toBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });

    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });

    try {
      await Share.share({ files: [uri], text, dialogTitle: 'Share the receipt' });
      return 'shared';
    } catch (err) {
      // A dismissed share sheet is not a failure.
      if (/cancel|abort|dismiss/i.test(String((err as Error)?.message ?? ''))) return 'shared';
      throw err;
    }
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
