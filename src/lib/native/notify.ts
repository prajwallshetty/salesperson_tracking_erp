'use client';

import { isNativeApp } from './platform';

/**
 * Shows an Android notification for a SalesGrid event that arrives while the app is in the
 * background. The realtime connection stays alive during a shift because the tracking foreground
 * service keeps the app process running; there is no push service (FCM) in this build, so nothing
 * is delivered once Android has stopped the app. In the foreground the in-app toast is used instead.
 */
let nextId = Math.floor(Date.now() % 2_000_000_000);

export async function showBackgroundNotification(title: string, body: string): Promise<void> {
  if (!isNativeApp() || typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;
    await LocalNotifications.schedule({ notifications: [{ id: nextId++ % 2_147_483_000, title, body: body.slice(0, 300) }] });
  } catch {
    /* notifications unavailable: the event is still in the in-app notification list */
  }
}
