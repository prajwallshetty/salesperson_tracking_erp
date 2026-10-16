'use client';

/**
 * localStorage access that never throws (private mode, quota, disabled storage).
 * Keys are namespaced per user so a shared device never shows one rep's queue to another.
 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKeys(prefix: string) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Stable per-browser device id reported with GPS points (legacy Expo app sent deviceId too). */
export function deviceId(): string {
  const existing = readJson<string | null>('sg_device_id', null);
  if (existing) return existing;
  const id = `web-${newId()}`;
  writeJson('sg_device_id', id);
  return id;
}
