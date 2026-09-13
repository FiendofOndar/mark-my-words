import { Capacitor } from '@capacitor/core';

/**
 * Which implementations to use.
 *
 * Every capability the web build cannot do properly sits behind a port, so this
 * file is the only place that knows there are two answers. Nothing below has
 * been run on a device: the container this was built in has no Android SDK, so
 * these adapters are written to the documented APIs and unverified.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function platformName(): string {
  return Capacitor.getPlatform();
}

/**
 * Open a cited page outside the app.
 *
 * On device this is a Chrome Custom Tab: a browser sheet that belongs to the
 * app, not to the user's Chrome session, and closes back to the app. A plain
 * target="_blank" anchor handed the URL to Android as an intent instead, which
 * brought the user's own Chrome to the front along with whatever it had open
 * last. The last thing it had open was the APK download from the GitHub
 * release, so every tap on a source link asked whether to download the app
 * again. In a browser this is an ordinary new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
