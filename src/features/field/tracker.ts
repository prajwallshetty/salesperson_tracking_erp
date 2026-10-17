'use client';

import { calculateHaversineDistanceMeters } from '@/lib/domain/geo';
import { deviceId, newId, readJson, writeJson } from './storage';
import { isNativeApp } from '@/lib/native/platform';
import { APP_RESUME_EVENT } from '@/lib/native/bridge';
import { NativeLocationError, startNativeTracking, stopNativeTracking, nativePermissions, type NativeFix } from './nativeLocation';

/**
 * GPS tracking for on-duty salespersons, with two location sources feeding one pipeline:
 *
 *  - Android app: a native foreground service (persistent notification) keeps fixes coming while the
 *    app is in the background or the screen is off.
 *  - Browser: tracking runs while the SalesGrid tab is open (browsers do not allow background
 *    geolocation); the optional Screen Wake Lock keeps the device awake during field work.
 *
 * Both go through the same sampling, buffer and authenticated batch upload. Only fixes reported by
 * the device are recorded; nothing is interpolated, and mock-location fixes are discarded.
 */

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';
export type TrackingStatus = 'idle' | 'acquiring' | 'tracking' | 'denied' | 'unavailable' | 'unsupported';
/** What the phone tells the server about its own capability (see POST /api/location/status). */
export type DeviceReport = 'TRACKING' | 'PERMISSION_DENIED' | 'BACKGROUND_DENIED' | 'GPS_DISABLED' | 'STOPPED';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speedKmh: number | null;
  heading: number | null;
  timestamp: string;
}

export interface TrackingState {
  status: TrackingStatus;
  permission: PermissionState;
  lastFix: Fix | null;
  buffered: number;
  lastUploadAt: string | null;
  lastError: string | null;
  wakeLock: boolean;
  wakeLockSupported: boolean;
  /** True when fixes continue in the background (Android foreground service running). */
  background: boolean;
  /** Android only: notifications are blocked, so Android may stop the background service silently. */
  notificationsBlocked: boolean;
}

interface BufferedPoint {
  clientPointId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  networkType: string | null;
  deviceId: string;
  timestamp: string;
}

const MOVING_INTERVAL_MS = 15_000;
const STATIONARY_INTERVAL_MS = 60_000;
const MIN_MOVE_METERS = 8;
const FLUSH_INTERVAL_MS = 30_000;
const MAX_BUFFER = 1000;
const BATCH_SIZE = 50;

export const geolocationErrorMessage = (code: number) =>
  code === 1
    ? 'Location permission is blocked. Allow location for this site in your browser settings, then reload.'
    : code === 2
      ? 'Your device could not determine its position. Move to an open area or enable GPS / location services.'
      : 'Timed out waiting for a GPS fix. Still trying…';

/** One-shot position for Start Day, visits and expenses. Resolves null (with reason) on failure. */
export function getCurrentFix(timeoutMs = 15000): Promise<{ fix: Fix | null; error?: string }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return resolve({ fix: null, error: 'This browser does not support location services.' });
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: toFix(p) }),
      (e) => resolve({ fix: null, error: geolocationErrorMessage(e.code) }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

function toFix(p: GeolocationPosition): Fix {
  return {
    latitude: p.coords.latitude,
    longitude: p.coords.longitude,
    accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
    speedKmh: p.coords.speed != null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 3.6 * 10) / 10 : null,
    heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
    timestamp: new Date(p.timestamp || Date.now()).toISOString(),
  };
}

export class FieldTracker {
  private state: TrackingState;
  private listeners = new Set<(s: TrackingState) => void>();
  private watchId: number | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastRecorded: BufferedPoint | null = null;
  private battery: { level: number } | null = null;
  private wakeLockSentinel: { release: () => Promise<void> } | null = null;
  private flushing = false;
  private nativeRunning = false;
  private pendingReport: { state: DeviceReport; detail?: string } | null = null;
  private lastReported: DeviceReport | null = null;
  private readonly bufferKey: string;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.isRunning) {
      this.flush();
      if (this.state.wakeLock) this.acquireWakeLock();
    }
  };
  // Back from the Android settings screen: try again if tracking was blocked.
  private readonly onResume = () => {
    if (this.nativeRunning && (this.state.status === 'denied' || this.state.status === 'unavailable')) void this.startNativeSource();
  };

  constructor(
    private userId: string,
    /** Return true if an offline Start Day is still waiting to sync (server would reject points). */
    private hasPendingStartDay: () => boolean,
    private onServerRejected: () => void
  ) {
    this.bufferKey = `sg_gps_buffer_${userId}`;
    this.state = {
      status: 'idle',
      permission: 'unknown',
      lastFix: null,
      buffered: this.buffer().length,
      lastUploadAt: null,
      lastError: null,
      wakeLock: false,
      wakeLockSupported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
      background: false,
      notificationsBlocked: false,
    };
    if (!isNativeApp()) this.watchPermission();
  }

  subscribe(fn: (s: TrackingState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => void this.listeners.delete(fn);
  }

  getState() {
    return this.state;
  }

  private set(patch: Partial<TrackingState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  private async watchPermission() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.set({ permission: 'unsupported', status: 'unsupported' });
      return;
    }
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
      if (status) {
        this.set({ permission: status.state as PermissionState });
        status.onchange = () => {
          this.set({ permission: status.state as PermissionState });
          if (status.state === 'granted' && this.state.status === 'denied') this.restartWatch();
        };
      }
    } catch {
      /* Permissions API unavailable (older Safari): state learned from geolocation callbacks. */
    }
  }

  private buffer(): BufferedPoint[] {
    return readJson<BufferedPoint[]>(this.bufferKey, []);
  }

  private saveBuffer(points: BufferedPoint[]) {
    const trimmed = points.slice(-MAX_BUFFER);
    writeJson(this.bufferKey, trimmed);
    this.set({ buffered: trimmed.length });
  }

  get isRunning() {
    return this.watchId !== null || this.nativeRunning;
  }

  start() {
    if (this.isRunning) return;
    const native = isNativeApp();
    if (!native && (typeof navigator === 'undefined' || !('geolocation' in navigator))) {
      this.set({ status: 'unsupported', lastError: 'This browser does not support location services.' });
      return;
    }
    this.set({ status: 'acquiring', lastError: null });
    this.readBattery();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (native) {
      this.nativeRunning = true;
      window.addEventListener(APP_RESUME_EVENT, this.onResume);
      void this.startNativeSource();
    } else {
      this.restartWatch();
    }
    this.flush();
  }

  /** Android: starts (or restarts) the foreground service and translates its failures honestly. */
  private async startNativeSource() {
    try {
      await startNativeTracking((fix) => this.onNativeFix(fix), (err) => this.onNativeFailure(err));
      const perms = await nativePermissions();
      const blocked = perms.notification === 'denied';
      this.set({
        background: true,
        notificationsBlocked: blocked,
        permission: 'granted',
        lastError: blocked ? 'Notifications are blocked: Android may stop background tracking. Allow notifications for SalesGrid in Android settings.' : this.state.lastError,
      });
      if (blocked) this.report('BACKGROUND_DENIED', 'Notifications blocked: Android may stop background tracking');
    } catch (err) {
      this.onNativeFailure(err instanceof NativeLocationError ? err : new NativeLocationError((err as Error).message, 'other'));
    }
  }

  private onNativeFailure(err: NativeLocationError) {
    if (err.kind === 'permission_denied') {
      this.set({ status: 'denied', permission: 'denied', background: false, lastError: 'Location permission is blocked. Allow location for SalesGrid in Android settings.' });
      this.report('PERMISSION_DENIED', 'Location permission refused on the phone');
    } else if (err.kind === 'location_disabled') {
      this.set({ status: 'unavailable', background: false, lastError: 'Location services are switched off. Turn on Location in Android quick settings.' });
      this.report('GPS_DISABLED', 'Phone location services are switched off');
    } else {
      this.set({ status: this.state.lastFix ? 'tracking' : 'unavailable', background: false, lastError: `Background tracking problem: ${err.message}` });
    }
  }

  private onNativeFix(fix: NativeFix) {
    if (fix.simulated) {
      // A mock-location app is feeding positions: they are not where the person is, so they are not recorded.
      this.set({ lastError: 'Mock location detected. Turn off mock-location apps; these positions are not recorded.' });
      return;
    }
    this.onFix(fix);
  }

  private restartWatch() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onFix(toFix(pos)),
      (err) => {
        if (err.code === 1) {
          this.set({ status: 'denied', permission: 'denied', lastError: geolocationErrorMessage(1) });
          this.report('PERMISSION_DENIED', 'Location permission refused in the browser');
        } else {
          this.set({ status: this.state.lastFix ? 'tracking' : err.code === 2 ? 'unavailable' : 'acquiring', lastError: geolocationErrorMessage(err.code) });
          if (err.code === 2 && !this.state.lastFix) this.report('GPS_DISABLED', 'The device could not determine its position');
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 }
    );
  }

  async stop(opts: { flush?: boolean } = { flush: true }) {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.nativeRunning) {
      this.nativeRunning = false;
      window.removeEventListener(APP_RESUME_EVENT, this.onResume);
      await stopNativeTracking(); // ends the foreground service and its notification
    }
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    await this.setWakeLock(false);
    if (opts.flush) await this.flush();
    this.lastRecorded = null;
    this.set({ status: 'idle', background: false });
    if (opts.flush) this.report('STOPPED');
  }

  /**
   * Tells the server what this phone can do, so the console can tell "permission denied" from "weak
   * signal". Best effort: queued and retried with the next upload if offline.
   */
  private report(state: DeviceReport, detail?: string) {
    if (this.lastReported === state && !this.pendingReport) return;
    this.pendingReport = { state, detail };
    void this.sendReport();
  }

  private async sendReport() {
    const r = this.pendingReport;
    if (!r) return;
    try {
      const res = await fetch('/api/location/status', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
      // 4xx (not on a salesperson account, invalid) will never succeed: drop it.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        if (res.ok) this.lastReported = r.state;
        if (this.pendingReport === r) this.pendingReport = null;
      }
    } catch {
      /* offline: stays pending and is retried by flush() */
    }
  }

  private async readBattery() {
    try {
      const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; addEventListener: (e: string, f: () => void) => void }> };
      const b = await nav.getBattery?.();
      if (b) {
        this.battery = b;
        b.addEventListener('levelchange', () => (this.battery = b));
      }
    } catch {
      /* Battery API not available (Safari/Firefox): battery stays unreported. */
    }
  }

  private onFix(fix: Fix) {
    this.set({ status: 'tracking', permission: 'granted', lastFix: fix, lastError: this.state.notificationsBlocked ? this.state.lastError : null });
    // First real fix of a run: the phone is evidently able to track. Browsers can only report while the page is open.
    if (this.lastReported !== 'TRACKING' && this.lastReported !== 'BACKGROUND_DENIED') {
      if (isNativeApp() && !this.state.notificationsBlocked) this.report('TRACKING');
      else if (!isNativeApp()) this.report('BACKGROUND_DENIED', 'Browser: reports only while this page is open');
    }

    // Adaptive sampling (legacy rules): 15 s while moving, 60 s stationary, skip < 8 m jitter.
    const last = this.lastRecorded;
    if (last) {
      const elapsed = new Date(fix.timestamp).getTime() - new Date(last.timestamp).getTime();
      const moved = calculateHaversineDistanceMeters(last.latitude, last.longitude, fix.latitude, fix.longitude);
      const moving = (fix.speedKmh ?? 0) > 5 || moved > 25;
      const minInterval = moving ? MOVING_INTERVAL_MS : STATIONARY_INTERVAL_MS;
      if (elapsed < minInterval && (moved < MIN_MOVE_METERS || elapsed < MOVING_INTERVAL_MS)) return;
    }

    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const point: BufferedPoint = {
      clientPointId: `web-${newId()}`,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      speed: fix.speedKmh,
      heading: fix.heading,
      batteryLevel: this.battery ? Math.round(this.battery.level * 100) : null,
      networkType: conn?.effectiveType ?? null,
      deviceId: deviceId(),
      timestamp: fix.timestamp,
    };
    this.lastRecorded = point;
    const buf = [...this.buffer(), point];
    this.saveBuffer(buf);
    if (buf.length >= 5) this.flush();
  }

  /** Uploads buffered points. Network failures keep them; server rejection drops them. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    void this.sendReport(); // retry a queued device report even when no points are waiting
    const buf = this.buffer();
    if (!buf.length) return;
    if (this.hasPendingStartDay()) return; // wait until the offline Start Day is synced
    this.flushing = true;
    try {
      for (let i = 0; i < buf.length; i += BATCH_SIZE) {
        const batch = buf.slice(i, i + BATCH_SIZE);
        let res: Response;
        try {
          res = await fetch('/api/location/batch', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ points: batch }),
          });
        } catch {
          this.set({ lastError: 'Offline — location points are saved on this device and will upload automatically.' });
          return;
        }
        if (res.status === 403) {
          // Day ended elsewhere (or never started): points can no longer be attributed to a session.
          this.saveBuffer([]);
          this.onServerRejected();
          return;
        }
        if (!res.ok && res.status !== 400) {
          this.set({ lastError: `Upload failed (HTTP ${res.status}); will retry.` });
          return;
        }
        const uploaded = new Set(batch.map((p) => p.clientPointId));
        this.saveBuffer(this.buffer().filter((p) => !uploaded.has(p.clientPointId)));
        this.set({ lastUploadAt: new Date().toISOString(), lastError: res.status === 400 ? 'Some invalid points were discarded.' : null });
      }
    } finally {
      this.flushing = false;
    }
  }

  private async acquireWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      this.wakeLockSentinel = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLockSentinel = null;
    }
  }

  async setWakeLock(on: boolean) {
    if (!on) {
      await this.wakeLockSentinel?.release().catch(() => undefined);
      this.wakeLockSentinel = null;
      this.set({ wakeLock: false });
      return;
    }
    await this.acquireWakeLock();
    this.set({ wakeLock: Boolean(this.wakeLockSentinel) });
  }

  clearLocal() {
    this.saveBuffer([]);
  }
}
