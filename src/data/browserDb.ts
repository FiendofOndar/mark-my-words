import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { openDatabase, type Db } from './db';
import { IndexedDbPersistence } from './indexedDbPersistence';

let instance: Promise<Db> | null = null;

/** One database per tab. Repeated calls share the same connection. */
export function getDb(): Promise<Db> {
  if (!instance) {
    instance = openDatabase({
      locateFile: () => wasmUrl,
      persistence: new IndexedDbPersistence(),
    });
  }
  return instance;
}

export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.driver.close();
  await new IndexedDbPersistence().clear();
  instance = null;
}
