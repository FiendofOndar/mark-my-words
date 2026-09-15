import { Directory, Filesystem } from '@capacitor/filesystem';
import { uuid } from '../lib/ids';

/**
 * The screenshot that came in through the share sheet.
 *
 * The native side reads the bytes off the share intent and hands them over
 * as base64; they are held here, in memory, for the capture screen to take.
 * Not in router state, which lives in history.state and has a size cap that
 * a phone screenshot can reach; not on disk, because keepScreenshot writes
 * the copy that outlives the capture. One share is held at a time: the next
 * replaces it, and a token says whether the one asked for is still the one
 * held.
 */
export interface SharedImage {
  /** Raw base64, no data: prefix. */
  data: string;
  mimeType: string;
}

let held: { token: string; image: SharedImage } | null = null;

export function holdSharedImage(image: SharedImage): string {
  const token = uuid();
  held = { token, image };
  return token;
}

export function takeSharedImage(token: string): SharedImage {
  if (!held || held.token !== token) {
    throw new Error('The shared picture is no longer in memory. Share it again.');
  }
  return held.image;
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
