import type { SqlDriver } from '../driver';

export class SettingsRepo {
  constructor(private db: SqlDriver) {}

  get(key: string): string | null {
    const rows = this.db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return rows[0] ? String(rows[0].value) : null;
  }

  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: string): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  all(): Record<string, string> {
    const rows = this.db.select<{ key: string; value: string }>('SELECT key, value FROM settings');
    return Object.fromEntries(rows.map((r) => [String(r.key), String(r.value)]));
  }
}

export const SETTING_KEYS = {
  seeded: 'demo_seeded',
  pullBudget: 'pull_budget',
  lateWatchDefault: 'late_watch_default',
  cooldown: 'provider_cooldown',
} as const;
