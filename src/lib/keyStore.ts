/**
 * Provider credentials and device-scoped model config.
 *
 * The API key deliberately never touches the SQLite database, because the
 * export in Settings hands the whole database file to whatever the user shares
 * it with. Phase 0.6 swaps this implementation for Android Keystore-backed
 * secure storage; the interface is what the rest of the app depends on.
 */
export type ProviderId = 'gemini' | 'mock';

export interface VerifierConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  dailyQuota: number | null;
}

const KEYS = {
  provider: 'mmw-provider',
  apiKey: 'mmw-api-key',
  model: 'mmw-model',
  quota: 'mmw-daily-quota',
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private window or blocked site data: the setting simply will not stick */
  }
}

export function loadVerifierConfig(): VerifierConfig {
  const stored = read(KEYS.provider);
  const provider: ProviderId = stored === 'gemini' ? 'gemini' : 'mock';
  const quota = read(KEYS.quota);

  return {
    provider,
    apiKey: read(KEYS.apiKey) ?? '',
    model: read(KEYS.model) ?? '',
    dailyQuota: quota === null || quota === '' ? null : Number(quota),
  };
}

export function saveVerifierConfig(config: Partial<VerifierConfig>): void {
  if (config.provider !== undefined) write(KEYS.provider, config.provider);
  if (config.apiKey !== undefined) write(KEYS.apiKey, config.apiKey.trim() || null);
  if (config.model !== undefined) write(KEYS.model, config.model.trim() || null);
  if (config.dailyQuota !== undefined) {
    write(KEYS.quota, config.dailyQuota === null ? null : String(config.dailyQuota));
  }
}

export function clearApiKey(): void {
  write(KEYS.apiKey, null);
}

/** Never print a key in full. */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(20, key.length - 8))}${key.slice(-4)}`;
}
