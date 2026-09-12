import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { openDatabase, type Db } from './db';
import { IndexedDbPersistence } from './indexedDbPersistence';
import { FilesystemPersistence } from '../platform/FilesystemPersistence';
import { isNative } from '../platform';
import type { Persistence } from './driver';

let instance: Promise<Db> | null = null;

function persistence(): Persistence {
  // sql.js runs in the Android WebView exactly as it does in a browser, so the
  // native build changes only where the image is kept.
  return isNative() ? new FilesystemPersistence() : new IndexedDbPersistence();
}

/** One database per app instance. Repeated calls share the connection. */
export function getDb(): Promise<Db> {
  instance ??= openDatabase({ locateFile: () => wasmUrl, persistence: persistence() });
  return instance;
}

export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.driver.close();
  await persistence().clear();
  instance = null;
}
