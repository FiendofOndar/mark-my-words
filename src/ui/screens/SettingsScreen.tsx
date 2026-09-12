import { useState } from 'react';
import { Screen } from '../components/Screen';
import { useDb } from '../DbProvider';
import { resetDb } from '../../data/browserDb';
import { MIGRATIONS } from '../../data/migrations';
import { applyTheme, readTheme, type Theme } from '../../lib/theme';
import { Field, SegmentedControl, inputClass } from '../components/Field';
import {
  loadVerifierConfig,
  maskKey,
  saveVerifierConfig,
  type ProviderId,
} from '../../lib/keyStore';
import { DEFAULT_GEMINI_MODEL, GeminiVerifier } from '../../verification/GeminiVerifier';
import { VerifierError } from '../../verification/types';

export function SettingsScreen() {
  const db = useDb();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [busy, setBusy] = useState(false);

  const stored = loadVerifierConfig();
  const [provider, setProvider] = useState<ProviderId>(stored.provider);
  const [apiKey, setApiKey] = useState(stored.apiKey);
  const [model, setModel] = useState(stored.model);
  const [keyDirty, setKeyDirty] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; message?: string }>({
    state: 'idle',
  });

  const chooseTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  const persistProvider = (next: ProviderId) => {
    setProvider(next);
    saveVerifierConfig({ provider: next });
    setTest({ state: 'idle' });
  };

  const saveKey = () => {
    saveVerifierConfig({ apiKey, model });
    setKeyDirty(false);
    setTest({ state: 'idle' });
  };

  const runTest = async () => {
    setTest({ state: 'running' });
    try {
      await new GeminiVerifier({ apiKey, model, timeoutMs: 20_000 }).testConnection();
      setTest({ state: 'ok', message: 'The key works.' });
    } catch (err) {
      const detail = err instanceof VerifierError ? err.detail : undefined;
      setTest({
        state: 'fail',
        message: `${(err as Error).message}${detail ? ` (${detail.slice(0, 160)})` : ''}`,
      });
    }
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
    drafts: db.predictions.list({ status: ['draft'] }).length,
    authors: db.authors.list().length,
  };

  return (
    <Screen title="Settings" back>
      <div className="space-y-7 px-5 py-5">
        <section>
          <SectionTitle>Drafting</SectionTitle>
          <div className="mt-2 space-y-4">
            <Field
              group
              label="Provider"
              hint={
                provider === 'gemini'
                  ? 'A real reading of the statement, with criteria you can actually check.'
                  : 'Offline pattern matching. Free, keyless, and not very good. Fine for trying the app out.'
              }
            >
              <SegmentedControl
                ariaLabel="Provider"
                value={provider}
                onChange={persistProvider}
                options={[
                  { value: 'mock', label: 'Offline' },
                  { value: 'gemini', label: 'Gemini' },
                ]}
              />
            </Field>

            {provider === 'gemini' && (
              <>
                <Field
                  label="API key"
                  hint="Stays on this device. Never written to the database, so it is not in the export."
                >
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyDirty(true);
                    }}
                    placeholder={stored.apiKey ? maskKey(stored.apiKey) : 'Paste your Gemini key'}
                    autoComplete="off"
                    className={inputClass}
                  />
                </Field>

                <Field label="Model" hint={`Blank uses ${DEFAULT_GEMINI_MODEL}.`}>
                  <input
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setKeyDirty(true);
                    }}
                    placeholder={DEFAULT_GEMINI_MODEL}
                    autoComplete="off"
                    className={inputClass}
                  />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveKey}
                    disabled={!keyDirty}
                    className="rounded bg-ink px-3 py-2 text-[13px] text-ground disabled:opacity-40"
                  >
                    {keyDirty ? 'Save' : 'Saved'}
                  </button>
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={!apiKey.trim() || test.state === 'running'}
                    className="rounded border border-rule px-3 py-2 text-[13px] text-ink-dim disabled:opacity-40"
                  >
                    {test.state === 'running' ? 'Testing...' : 'Test connection'}
                  </button>
                </div>

                {test.message && (
                  <p
                    className={`text-[13px] ${test.state === 'ok' ? 'text-hit' : 'text-miss'}`}
                    role="status"
                  >
                    {test.message}
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <section>
          <SectionTitle>On this device</SectionTitle>
          <p className="mt-2 text-[15px] text-ink-dim">
            {counts.predictions} prediction{counts.predictions === 1 ? '' : 's'}
            {counts.drafts > 0 && `, ${counts.drafts} still a draft`} · {counts.authors} author
            {counts.authors === 1 ? '' : 's'} · schema v{MIGRATIONS[MIGRATIONS.length - 1]?.version}
          </p>
        </section>

        <section>
          <SectionTitle>Theme</SectionTitle>
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
          <SectionTitle>Data</SectionTitle>
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
                Clears the database and reseeds the demo predictions. Your key is kept.
              </span>
            </button>
          </div>
        </section>

        <p className="text-[12px] text-ink-faint">
          Phase 0.2. Intake drafting works; verification, notifications and archiving do not exist
          yet.
        </p>
      </div>
    </Screen>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{children}</h2>
  );
}
