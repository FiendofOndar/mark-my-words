import { useState } from 'react';
import { Screen } from '../components/Screen';
import { useDb } from '../DbProvider';
import { resetDb } from '../../data/browserDb';
import { MIGRATIONS } from '../../data/migrations';
import { applyTheme, readTheme, type Theme } from '../../lib/theme';

export function SettingsScreen() {
  const db = useDb();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [busy, setBusy] = useState(false);

  const chooseTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  const exportData = () => {
    const bytes = db.driver.export();
    const blob = new Blob([bytes as BlobPart], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mark-my-words-${new Date().toISOString().slice(0, 10)}.sqlite`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const wipe = async () => {
    if (!confirm('Delete every prediction on this device? This cannot be undone.')) return;
    setBusy(true);
    await resetDb();
    location.reload();
  };

  const counts = {
    predictions: db.predictions.list().length,
    authors: db.authors.list().length,
  };

  return (
    <Screen title="Settings" back>
      <div className="space-y-6 px-5 py-5">
        <section>
          <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
            On this device
          </h2>
          <p className="mt-2 text-[15px] text-ink-dim">
            {counts.predictions} prediction{counts.predictions === 1 ? '' : 's'} ·{' '}
            {counts.authors} author{counts.authors === 1 ? '' : 's'} · schema v
            {MIGRATIONS[MIGRATIONS.length - 1]?.version}
          </p>
        </section>

        <section>
          <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Theme</h2>
          <div className="mt-2 flex gap-2">
            {(['dark', 'light'] as Theme[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => chooseTheme(option)}
                className={`flex-1 rounded border px-3 py-2 text-[13px] capitalize ${
                  theme === option ? 'border-ink bg-ink text-ground' : 'border-rule text-ink-dim'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Data</h2>
          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={exportData}
              className="w-full rounded border border-rule px-3 py-2.5 text-left text-[15px] text-ink-dim"
            >
              Export database file
              <span className="block text-[12px] text-ink-faint">
                Raw SQLite. JSON export with screenshots arrives in phase 0.6.
              </span>
            </button>
            <button
              type="button"
              onClick={wipe}
              disabled={busy}
              className="w-full rounded border border-miss/50 px-3 py-2.5 text-left text-[15px] text-miss disabled:opacity-40"
            >
              Erase everything
              <span className="block text-[12px] text-miss/70">
                Clears the database and reseeds the demo predictions.
              </span>
            </button>
          </div>
        </section>

        <p className="text-[12px] text-ink-faint">
          Phase 0.1. No verification, no notifications, no network. Everything here is local.
        </p>
      </div>
    </Screen>
  );
}
