/** Pure decisions for the Android shell (unit-tested; no Capacitor imports). */

/** Screens where Back leaves the app instead of navigating (it is minimised, so GPS keeps running). */
export const ROOT_PATHS = ['/', '/login', '/field', '/dashboard'];

export type BackAction = 'close-overlay' | 'history-back' | 'minimize';

export function decideBack(input: { pathname: string; overlayOpen: boolean; canGoBack: boolean }): BackAction {
  if (input.overlayOpen) return 'close-overlay';
  const path = input.pathname.replace(/\/+$/, '') || '/';
  if (ROOT_PATHS.includes(path)) return 'minimize';
  return input.canGoBack ? 'history-back' : 'minimize';
}

/** Biometric lock: always on a cold start, and after this long in the background. */
export const LOCK_AFTER_BACKGROUND_MS = 5 * 60 * 1000;

export function shouldLock(input: { enabled: boolean; coldStart: boolean; backgroundedAt: number | null; now: number }): boolean {
  if (!input.enabled) return false;
  if (input.coldStart) return true;
  return input.backgroundedAt !== null && input.now - input.backgroundedAt >= LOCK_AFTER_BACKGROUND_MS;
}

/** Android versionCode check for the "update required" gate. Unknown values never block. */
export function isBelowMinimumBuild(current: string | number | undefined, minimum: number | null | undefined): boolean {
  const cur = Number(current);
  if (!minimum || !Number.isFinite(cur) || cur <= 0) return false;
  return cur < minimum;
}
