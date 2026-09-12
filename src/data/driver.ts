/**
 * The database port.
 *
 * v0.1 ships one implementation (sql.js, running in the browser or in tests).
 * Phase 0.6 adds a Capacitor SQLite implementation behind this same interface,
 * so repositories never learn which one they are talking to.
 */
export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = SqlValue[];

export interface SqlDriver {
  select<T = Record<string, SqlValue>>(sql: string, params?: SqlParams): T[];
  run(sql: string, params?: SqlParams): void;
  /** Synchronous because sql.js is synchronous; the native driver will wrap its own batch API. */
  transaction<T>(fn: () => T): T;
  /** Write the current database image to durable storage. */
  persist(): Promise<void>;
  export(): Uint8Array;
  close(): Promise<void>;
}

/** Where the database image lives between sessions. */
export interface Persistence {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  private bytes: Uint8Array | null = null;
  async load() {
    return this.bytes;
  }
  async save(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  async clear() {
    this.bytes = null;
  }
}
