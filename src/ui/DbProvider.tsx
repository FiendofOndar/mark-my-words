import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Db } from '../data/db';
import { getDb } from '../data/appDb';
import { seedDemoData } from '../data/seed';

const DbContext = createContext<Db | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDb()
      .then((instance) => {
        if (cancelled) return;
        seedDemoData(instance);
        setDb(instance);
      })
      .catch((err) => !cancelled && setError(err as Error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="p-6 text-miss">
        <p className="text-lg">The database would not open.</p>
        <p className="mt-2 font-sans text-sm text-ink-dim">{error.message}</p>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <span className="font-quote text-xl font-semibold italic">Opening the ledger...</span>
      </div>
    );
  }

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used inside a DbProvider');
  return db;
}
