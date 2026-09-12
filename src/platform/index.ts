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
