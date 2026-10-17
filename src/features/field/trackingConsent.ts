'use client';

import { isNativeApp } from '@/lib/native/platform';

/**
 * The Android app records location in the background (foreground service) while the salesperson is
 * on duty. Before that is switched on for the first time, the person must read and accept a plain
 * explanation (a Google Play requirement and ordinary good practice). The decision is stored per user
 * on this device only; it is not a permission — Android still asks for the location permission itself.
 */
const key = (userId: string) => `salesgrid.trackingConsent.v1.${userId}`;

export const TRACKING_DISCLOSURE = [
  'SalesGrid records your phone’s location while you are on duty — including when the app is in the background or the screen is off.',
  'A notification stays visible while this is happening. Tracking stops when you end your day.',
  'The location trail is used for your route and distance, to verify client visits, and so your manager can see where the team is during working hours.',
  'Nothing is recorded while you are off duty.',
];

export async function needsTrackingConsent(userId: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  const { Preferences } = await import('@capacitor/preferences');
  return (await Preferences.get({ key: key(userId) })).value !== 'accepted';
}

export async function acceptTrackingConsent(userId: string): Promise<void> {
  const { Preferences } = await import('@capacitor/preferences');
  await Preferences.set({ key: key(userId), value: 'accepted' });
  // Foreground-service notification (Android 13+) and in-app alerts use the same notification permission.
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.requestPermissions();
  } catch {
    /* denied or unavailable: tracking still works, the notification may be hidden by Android */
  }
}

export async function clearTrackingConsent(userId: string): Promise<void> {
  if (!isNativeApp()) return;
  const { Preferences } = await import('@capacitor/preferences');
  await Preferences.remove({ key: key(userId) });
}
