import * as Location from 'expo-location';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config';
import { apiRequest } from './api';
import { enqueueOperation } from '../storage/db';

const BUFFER_KEY = '@erp_location_buffer';

export interface LocationTrackingState {
  isTrackingActive: boolean;
  accuracyMeters: number | null;
  speedKmh: number | null;
  lastCapturedAt: string | null;
  bufferedCount: number;
  isMoving: boolean;
}

let trackingTimer: any = null;
let cachedCurrentLocation: { latitude: number; longitude: number } | null = null;
let isTrackingActive = false;
let lastRecordedPoint: any = null;

// Listeners for UI status banners
type TrackingListener = (state: LocationTrackingState) => void;
const listeners: Set<TrackingListener> = new Set();

function notifyListeners() {
  const state = getTrackingState();
  listeners.forEach((l) => l(state));
}

export function subscribeTrackingState(listener: TrackingListener): () => void {
  listeners.add(listener);
  listener(getTrackingState());
  return () => {
    listeners.delete(listener);
  };
}

export function getTrackingState(): LocationTrackingState {
  const speed = lastRecordedPoint?.speed ?? 0;
  return {
    isTrackingActive,
    accuracyMeters: lastRecordedPoint?.accuracy ?? null,
    speedKmh: speed,
    lastCapturedAt: lastRecordedPoint?.timestamp ?? null,
    bufferedCount: 0,
    isMoving: speed > 5,
  };
}

// Request Foreground & Background Permissions
export async function requestLocationPermissions(): Promise<{ granted: boolean; status: string }> {
  try {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      return { granted: false, status: fgStatus };
    }

    if (Platform.OS !== 'web') {
      try {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        return { granted: true, status: bgStatus };
      } catch (e) {
        // Fallback to foreground execution
        return { granted: true, status: fgStatus };
      }
    }

    return { granted: true, status: fgStatus };
  } catch (err: any) {
    console.warn('Failed to request location permissions:', err);
    return { granted: false, status: 'error' };
  }
}

// Get single coordinates for visit verification / check-in
export async function getCurrentCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    cachedCurrentLocation = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    };
    return cachedCurrentLocation;
  } catch (err) {
    return cachedCurrentLocation;
  }
}

// Local Buffer Management
async function getBuffer(): Promise<any[]> {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveToBuffer(points: any[]): Promise<void> {
  try {
    const current = await getBuffer();
    const updated = [...current, ...points].slice(-200); // Keep last 200 points max locally
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to buffer location points:', e);
  }
}

async function removeUploadedFromBuffer(uploadedIds: string[]): Promise<void> {
  try {
    const current = await getBuffer();
    const remaining = current.filter((p) => !uploadedIds.includes(p.clientPointId));
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(remaining));
  } catch (e) {
    console.error('Failed to prune location buffer:', e);
  }
}

// Flush local buffer to backend in batches
export async function flushLocationBuffer(): Promise<number> {
  const buffer = await getBuffer();
  if (buffer.length === 0) return 0;

  const batch = buffer.slice(0, 20); // Flush in batches of 20
  try {
    await apiRequest('/api/location/batch', {
      method: 'POST',
      body: JSON.stringify({ points: batch }),
    });

    const uploadedIds = batch.map((p) => p.clientPointId);
    await removeUploadedFromBuffer(uploadedIds);
    return batch.length;
  } catch (err) {
    // Keep in buffer for next flush attempt
    return 0;
  }
}

// Distance calculation between two lat/lng in meters
function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Single capture step with adaptive sampling
async function captureSample(): Promise<void> {
  // CRITICAL: Stop new location collection immediately when duty is off
  if (!isTrackingActive) return;

  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    if (!isTrackingActive) return; // Re-check after async location resolve

    const speedKmh =
      loc.coords.speed !== null && loc.coords.speed >= 0
        ? Math.round(loc.coords.speed * 3.6)
        : 0;

    const lat = loc.coords.latitude;
    const lng = loc.coords.longitude;
    const accuracy = loc.coords.accuracy || 10;

    // Filter implausible jumps or stationary noise
    if (lastRecordedPoint) {
      const distMeters = haversineDistanceMeters(
        lastRecordedPoint.latitude,
        lastRecordedPoint.longitude,
        lat,
        lng
      );

      // If stationary and moved less than 8m, skip redundant recording unless 3 minutes elapsed
      const timeDiffSec = (Date.now() - new Date(lastRecordedPoint.timestamp).getTime()) / 1000;
      if (distMeters < 8 && speedKmh < 3 && timeDiffSec < 180) {
        return;
      }
    }

    const point = {
      clientPointId: `cpt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      latitude: lat,
      longitude: lng,
      accuracy,
      speed: speedKmh,
      heading: loc.coords.heading || null,
      timestamp: new Date().toISOString(),
    };

    lastRecordedPoint = point;
    cachedCurrentLocation = { latitude: lat, longitude: lng };
    notifyListeners();

    // 1. Save to persistent local buffer
    await saveToBuffer([point]);

    // 2. Attempt immediate flush
    await flushLocationBuffer();
  } catch (e) {
    console.warn('GPS sample capture skipped:', e);
  }
}

// Schedule next adaptive sample
function scheduleNextSample(): void {
  if (!isTrackingActive) return;

  // Adaptive sampling:
  // Moving (> 5 km/h): 15 seconds
  // Stationary: 60 seconds
  const currentSpeed = lastRecordedPoint?.speed || 0;
  const intervalMs = currentSpeed > 5 ? 15000 : 60000;

  if (trackingTimer) clearTimeout(trackingTimer);
  trackingTimer = setTimeout(async () => {
    if (!isTrackingActive) return;
    await captureSample();
    scheduleNextSample();
  }, intervalMs);
}

// Start Duty Tracking
export function startDutyTracking(): void {
  if (isTrackingActive) return;
  isTrackingActive = true;
  notifyListeners();

  // Flush any pending points from previous session or restart
  flushLocationBuffer();

  // Initial immediate sample
  captureSample().finally(() => {
    scheduleNextSample();
  });
}

// Stop Duty Tracking Immediately (Offline or Online)
export function stopDutyTracking(): void {
  isTrackingActive = false;
  if (trackingTimer) {
    clearTimeout(trackingTimer);
    trackingTimer = null;
  }
  notifyListeners();

  // Attempt final flush of buffered points
  flushLocationBuffer();
}
