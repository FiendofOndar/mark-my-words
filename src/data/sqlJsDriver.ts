import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { Persistence, SqlDriver, SqlParams, SqlValue } from './driver';

let sqlJs: SqlJsStatic | null = null;

async function getSqlJs(locateFile: (file: string) => string): Promise<SqlJsStatic> {
  if (!sqlJs) sqlJs = await initSqlJs({ locateFile });
  return sqlJs;
}

export interface SqlJsDriverOptions {
  locateFile: (file: string) => string;
  persistence: Persistence;
  /** Milliseconds to coalesce writes before saving the image. 0 saves immediately. */
  persistDebounceMs?: number;
}

class SqlJsDriver implements SqlDriver {
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inTransaction = false;

  constructor(
    private db: Database,
    private persistence: Persistence,
    private debounceMs: number,
  ) {}

  select<T = Record<string, SqlValue>>(sql: string, params: SqlParams = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(sql: string, params: SqlParams = []): void {
    this.db.run(sql, params as never);
    this.markDirty();
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.inTransaction = true;
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this.markDirty();
      return result;
    } catch (err) {
      // SQLite auto-rolls back on some errors, so a failing ROLLBACK here must
      // not be allowed to mask the error that actually caused the failure.
      try {
        this.db.run('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  private markDirty() {
    this.dirty = true;
    // sql.js implements export() by closing and reopening the database, which
    // silently ends any open transaction. Never persist mid-transaction; the
    // markDirty call after COMMIT covers the whole batch.
    if (this.inTransaction) return;
    if (this.debounceMs === 0) {
      void this.persist();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, this.debounceMs);
  }

  export(): Uint8Array {
    return this.db.export();
  }

  async persist(): Promise<void> {
    if (this.inTransaction) return; // see markDirty
    if (!this.dirty) return;
    this.dirty = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.persistence.save(this.db.export());
  }

  async close(): Promise<void> {
    await this.persist();
    this.db.close();
  }
}

export async function createSqlJsDriver(opts: SqlJsDriverOptions): Promise<SqlDriver> {
  const SQL = await getSqlJs(opts.locateFile);
  const existing = await opts.persistence.load();
  const db = existing ? new SQL.Database(existing) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  return new SqlJsDriver(db, opts.persistence, opts.persistDebounceMs ?? 250);
}
