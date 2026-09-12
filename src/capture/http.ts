import { CapacitorHttp } from '@capacitor/core';
import { isNative } from '../platform';
import type { ArchiveHttp } from './archive';

/**
 * Archiving needs cross-origin requests with real status codes and the final
 * URL after redirects, which the browser cannot give. On the web this reports
 * failure honestly rather than pretending; on device it goes through native
 * code and works.
 */
class CapacitorArchiveHttp implements ArchiveHttp {
  async get(url: string, timeoutMs: number) {
    const response = await CapacitorHttp.get({
      url,
      readTimeout: timeoutMs,
      connectTimeout: timeoutMs,
      responseType: 'text',
    });
    return {
      status: response.status,
      text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
      finalUrl: response.url ?? url,
    };
  }
}

class BrowserArchiveHttp implements ArchiveHttp {
  async get(url: string, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      return { status: response.status, text: await response.text(), finalUrl: response.url };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const archiveHttp: ArchiveHttp = isNative()
  ? new CapacitorArchiveHttp()
  : new BrowserArchiveHttp();
