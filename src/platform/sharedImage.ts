import { Directory, Filesystem } from '@capacitor/filesystem';
import { uuid } from '../lib/ids';

/**
 * The screenshot that came in through the share sheet.
 *
 * Android hands over a content:// URI that is only valid for the moment of
 * the share, so the bytes are read once and kept in the app's own storage:
 * the model reads them now, and the detail screen shows them later as the
 * source, which for Instagram and X is the only archive there will be.
 */
export interface SharedImage {
  /** Raw base64, no data: prefix. */
  data: string;
  mimeType: string;
}

export async function readSharedImage(uri: string, mimeHint?: string | null): Promise<SharedImage> {
  const { data } = await Filesystem.readFile({ path: uri });
  const mimeType =
    mimeHint && mimeHint.startsWith('image/') && !mimeHint.endsWith('*') ? mimeHint : 'image/jpeg';
  return { data: typeof data === 'string' ? data : await blobToBase64(data), mimeType };
}

const CAPTURES = 'captures';

/** Keep the bytes; returns the path the prediction row stores. */
export async function keepScreenshot(image: SharedImage): Promise<string> {
  const ext = image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${CAPTURES}/${uuid()}.${ext}`;
  await Filesystem.writeFile({ path, data: image.data, directory: Directory.Data, recursive: true });
  return path;
}

/** A data: URL for an <img>, or null when the file is gone. */
export async function loadScreenshot(path: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
    const base64 = typeof data === 'string' ? data : await blobToBase64(data);
    const mime = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
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
