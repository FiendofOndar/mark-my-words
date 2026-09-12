import type { Persistence } from './driver';

const DB_NAME = 'mark-my-words';
const STORE = 'sqlite';
const KEY = 'image';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openIdb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const req = fn(transaction.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** Browser persistence: the whole SQLite image as one IndexedDB blob. */
export class IndexedDbPersistence implements Persistence {
  async load(): Promise<Uint8Array | null> {
    const value = await tx<ArrayBuffer | undefined>('readonly', (s) => s.get(KEY));
    return value ? new Uint8Array(value) : null;
  }

  async save(bytes: Uint8Array): Promise<void> {
    // Copy into a plain ArrayBuffer so structured clone does not choke on views.
    const buffer = bytes.slice().buffer;
    await tx('readwrite', (s) => s.put(buffer, KEY));
  }

  async clear(): Promise<void> {
    await tx('readwrite', (s) => s.delete(KEY));
  }
}
