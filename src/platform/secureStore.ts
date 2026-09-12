import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { isNative } from './index';

/**
 * Credential storage.
 *
 * On device this is Android Keystore-backed. In a browser it falls back to
 * localStorage, which is the best available and is why the web build should be
 * treated as development rather than as somewhere to keep a real key.
 */
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

class KeystoreStore implements SecureStore {
  async get(key: string): Promise<string | null> {
    try {
      const { value } = await SecureStoragePlugin.get({ key });
      return value;
    } catch {
      return null; // the plugin throws rather than returning null when absent
    }
  }
  async set(key: string, value: string): Promise<void> {
    await SecureStoragePlugin.set({ key, value });
  }
  async remove(key: string): Promise<void> {
    try {
      await SecureStoragePlugin.remove({ key });
    } catch {
      /* already gone */
    }
  }
}

class LocalStorageStore implements SecureStore {
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private window or blocked site data */
    }
  }
  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  }
}

export const secureStore: SecureStore = isNative() ? new KeystoreStore() : new LocalStorageStore();
