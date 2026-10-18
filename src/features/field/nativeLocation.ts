'use client';

import type { PermissionState } from '@capacitor/core';

/**
 * Android background tracking (Capacitor): a foreground service with a persistent notification keeps
 * location updates coming while the app is in the background or the screen is off. Used only inside
 * the Bharath Interior Decor Android app and only while a salesperson is on duty (the tracker starts/stops it).
 * Fixes still go through the same buffer, filters and authenticated upload as in the browser.
 */

export interface NativeFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speedKmh: number | null;
  heading: number | null;
  timestamp: string;
  /** Reported by Android for mock-location apps. Such fixes are discarded by the tracker. */
  simulated: boolean;
}

export type NativeFailure = 'permission_denied' | 'location_disabled' | 'other';

export class NativeLocationError extends Error {
  constructor(message: string, readonly kind: NativeFailure, readonly code?: string) {
    super(message);
  }
}

export interface NativePermissions {
  location: PermissionState | 'unknown';
  notification: PermissionState | 'unknown';
}

const plugin = async () => (await import('@capgo/background-geolocation')).BackgroundGeolocation;

export async function nativePermissions(): Promise<NativePermissions> {
  try {
    const p = await (await plugin()).checkPermissions();
    return { location: p.location ?? 'unknown', notification: p.notification ?? 'unknown' };
  } catch {
    return { location: 'unknown', notification: 'unknown' };
  }
}

function classify(err: unknown): NativeLocationError {
  const e = err as { message?: string; code?: string };
  const message = e?.message || 'Location tracking could not start.';
  if (e?.code === 'NOT_AUTHORIZED') {
    return new NativeLocationError(message, /disabled/i.test(message) ? 'location_disabled' : 'permission_denied', e.code);
  }
  return new NativeLocationError(message, 'other', e?.code);
}

/**
 * Starts the foreground service. Resolves once updates are flowing; rejects with a
 * NativeLocationError (permission denied / location services off / other). Any previous watcher is
 * stopped first so an app restart never leaves two services running.
 */
export async function startNativeTracking(onFix: (fix: NativeFix) => void, onError: (err: NativeLocationError) => void): Promise<void> {
  const bg = await plugin();
  await bg.stop().catch(() => undefined);
  try {
    await bg.start(
      {
        backgroundTitle: 'Bharath Interior Decor is recording your route',
        backgroundMessage: 'Your location is recorded while you are on duty. End your day to stop.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
        minIntervalMs: 10_000,
      },
      (loc, error) => {
        if (error) return onError(classify(error));
        if (!loc) return;
        onFix({
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: Number.isFinite(loc.accuracy) ? loc.accuracy : null,
          // Android reports metres per second; Bharath Interior Decor stores km/h.
          speedKmh: loc.speed != null && loc.speed >= 0 ? Math.round(loc.speed * 3.6 * 10) / 10 : null,
          heading: loc.bearing != null && !Number.isNaN(loc.bearing) ? loc.bearing : null,
          timestamp: new Date(loc.time ?? Date.now()).toISOString(),
          simulated: Boolean(loc.simulated),
        });
      }
    );
  } catch (err) {
    throw classify(err);
  }
}

export async function stopNativeTracking(): Promise<void> {
  await (await plugin()).stop().catch(() => undefined);
}

/** Opens the Android location / app settings so the user can fix permissions or battery limits. */
export async function openNativeSettings(): Promise<void> {
  await (await plugin()).openSettings().catch(() => undefined);
}
