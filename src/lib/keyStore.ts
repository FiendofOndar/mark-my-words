/**
 * Provider credentials and device-scoped model config.
 *
 * The API key deliberately never touches the SQLite database, because the
 * export in Settings hands the whole database file to whatever the user shares
 * it with. On device it is held in Android Keystore-backed storage; in a
 * browser it falls back to localStorage, which is why the web build should be
 * treated as development rather than somewhere to keep a real key.
 *
 * The underlying store is async, so values are read once at startup and held in
 * memory. Everything that renders reads the cache synchronously.
 */
import { secureStore } from '../platform/secureStore';

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

const EMPTY: VerifierConfig = { provider: 'mock', apiKey: '', model: '', dailyQuota: null };

let cache: VerifierConfig = { ...EMPTY };

/** Call once before the app renders. */
export async function initVerifierConfig(): Promise<VerifierConfig> {
  const [provider, apiKey, model, quota] = await Promise.all([
    secureStore.get(KEYS.provider),
    secureStore.get(KEYS.apiKey),
    secureStore.get(KEYS.model),
    secureStore.get(KEYS.quota),
  ]);

  cache = {
    provider: provider === 'gemini' ? 'gemini' : 'mock',
    apiKey: apiKey ?? '',
    model: model ?? '',
    dailyQuota: quota === null || quota === '' ? null : Number(quota),
  };
  return cache;
}

export function loadVerifierConfig(): VerifierConfig {
  return cache;
}

export async function saveVerifierConfig(config: Partial<VerifierConfig>): Promise<VerifierConfig> {
  cache = { ...cache, ...config };
  if (typeof config.apiKey === 'string') cache.apiKey = config.apiKey.trim();
  if (typeof config.model === 'string') cache.model = config.model.trim();

  const writes: Promise<void>[] = [];
  if (config.provider !== undefined) writes.push(secureStore.set(KEYS.provider, cache.provider));
  if (config.apiKey !== undefined) {
    writes.push(
      cache.apiKey ? secureStore.set(KEYS.apiKey, cache.apiKey) : secureStore.remove(KEYS.apiKey),
    );
  }
  if (config.model !== undefined) {
    writes.push(
      cache.model ? secureStore.set(KEYS.model, cache.model) : secureStore.remove(KEYS.model),
    );
  }
  if (config.dailyQuota !== undefined) {
    writes.push(
      cache.dailyQuota === null
        ? secureStore.remove(KEYS.quota)
        : secureStore.set(KEYS.quota, String(cache.dailyQuota)),
    );
  }

  await Promise.all(writes);
  return cache;
}

export async function clearApiKey(): Promise<void> {
  await saveVerifierConfig({ apiKey: '' });
}

/** Never print a key in full. */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(20, key.length - 8))}${key.slice(-4)}`;
}
