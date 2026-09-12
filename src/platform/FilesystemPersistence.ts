import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { Persistence } from '../data/driver';

/**
 * The database image as a file in app storage.
 *
 * sql.js runs in the Android WebView exactly as it does in a browser, so the
 * native build reuses the same driver and only changes where the image lives.
 * A file is easier to back up than an IndexedDB blob and survives a WebView
 * data clear. At this data size rewriting the whole image on each save costs
 * nothing worth optimizing.
 */
const PATH = 'mark-my-words.sqlite.b64';

export class FilesystemPersistence implements Persistence {
  async load(): Promise<Uint8Array | null> {
    try {
      const { data } = await Filesystem.readFile({
        path: PATH,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return base64ToBytes(typeof data === 'string' ? data : '');
    } catch {
      return null; // first run
    }
  }

  async save(bytes: Uint8Array): Promise<void> {
    await Filesystem.writeFile({
      path: PATH,
      data: bytesToBase64(bytes),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }

  async clear(): Promise<void> {
    try {
      await Filesystem.deleteFile({ path: PATH, directory: Directory.Data });
    } catch {
      /* nothing to delete */
    }
  }
}

/** Chunked, because spreading a megabyte-scale array blows the argument limit. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
