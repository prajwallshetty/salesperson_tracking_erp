'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/components/shared/SessionProvider';
import { useSocket } from '@/components/shared/RealtimeProvider';
import { apiJson, isNetworkError, errorMessage } from '@/lib/client/apiFetch';
import { enqueue, getOutbox, syncOutbox, updateItems, removeItem, type OutboxItem, type OutboxType, type SyncOutcome } from './outbox';
import { FieldTracker, getCurrentFix, type Fix, type TrackingState } from './tracker';
import { deviceId, newId, removeKeys } from './storage';

export interface DashboardData {
  todaySales: number;
  ordersCount: number;
  verifiedCollections: number;
  pendingCollections: number;
  totalCollectionsToday: number;
  clientsVisited: number;
  totalAssignedClients: number;
  totalAssignedOutstanding: number;
  dutyStatus: 'ON_DUTY' | 'OFF_DUTY';
  loginTime: string | null;
}

export type ActionResult<T = unknown> = { ok: true; offline: boolean; data?: T } | { ok: false; error: string };

interface FieldContextValue {
  dashboard: DashboardData | null;
  dashboardError: string | null;
  refreshDashboard: () => Promise<void>;
  dutyStatus: 'ON_DUTY' | 'OFF_DUTY';
  dutyPendingSync: boolean;
  tracking: TrackingState;
  setWakeLock: (on: boolean) => Promise<void>;
  outbox: OutboxItem[];
  online: boolean;
  syncing: boolean;
  syncNow: (includeFailed?: boolean) => Promise<SyncOutcome>;
  discardOutboxItem: (id: string) => void;
  startDay: (opts?: { allowWithoutLocation?: boolean }) => Promise<ActionResult & { locationError?: string }>;
  endDay: () => Promise<ActionResult<any>>;
  /** POSTs to the API; queues for sync only if the server is unreachable. */
  submit: <T = any>(args: { url: string; body: Record<string, unknown>; type: OutboxType; label: string; idempotencyKey: string }) => Promise<ActionResult<T>>;
  currentFix: () => Promise<{ fix: Fix | null; error?: string }>;
  settings: Record<string, string>;
}

const FieldContext = createContext<FieldContextValue | undefined>(undefined);

export function FieldProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const { lastEvent } = useSocket();
  const userId = user!.id;

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const trackerRef = useRef<FieldTracker | null>(null);
  const [tracking, setTracking] = useState<TrackingState>({
    status: 'idle', permission: 'unknown', lastFix: null, buffered: 0, lastUploadAt: null, lastError: null, wakeLock: false, wakeLockSupported: false,
  });

  const refreshDashboard = useCallback(async () => {
    try {
      setDashboard(await apiJson<DashboardData>('/api/salespersons/dashboard'));
      setDashboardError(null);
    } catch (err) {
      setDashboardError(errorMessage(err));
    }
  }, []);

  // Effective duty status: server truth, overridden by START/END_DAY still waiting in the outbox.
  const pendingDuty = useMemo(() => {
    const duty = outbox.filter((i) => i.type === 'START_DAY' || i.type === 'END_DAY');
    const last = duty[duty.length - 1];
    return last ? (last.type === 'START_DAY' ? 'ON_DUTY' : 'OFF_DUTY') : null;
  }, [outbox]);
  const dutyStatus = (pendingDuty ?? dashboard?.dutyStatus ?? 'OFF_DUTY') as 'ON_DUTY' | 'OFF_DUTY';

  // Tracker lifecycle.
  useEffect(() => {
    const tracker = new FieldTracker(
      userId,
      () => getOutbox(userId).some((i) => i.type === 'START_DAY'),
      () => refreshDashboard()
    );
    trackerRef.current = tracker;
    const unsub = tracker.subscribe(setTracking);
    return () => {
      unsub();
      tracker.stop({ flush: false });
    };
  }, [userId, refreshDashboard]);

  useEffect(() => {
    const t = trackerRef.current;
    if (!t || !dashboard) return;
    if (dutyStatus === 'ON_DUTY' && !t.isRunning) t.start();
    if (dutyStatus === 'OFF_DUTY' && t.isRunning) t.stop();
  }, [dutyStatus, dashboard]);

  const reloadOutbox = useCallback(() => setOutbox(getOutbox(userId)), [userId]);

  const syncNow = useCallback(
    async (includeFailed = false) => {
      setSyncing(true);
      try {
        const res = await syncOutbox(userId, { includeFailed });
        reloadOutbox();
        if (res.synced) {
          await refreshDashboard();
          await trackerRef.current?.flush();
        }
        return res;
      } finally {
        setSyncing(false);
      }
    },
    [userId, reloadOutbox, refreshDashboard]
  );

  useEffect(() => {
    reloadOutbox();
    refreshDashboard();
    apiJson<{ data: { key: string; value: string }[] }>('/api/settings')
      .then((r) => setSettings(Object.fromEntries(r.data.map((s) => [s.key, s.value]))))
      .catch(() => undefined);
    setOnline(navigator.onLine);
    const onChange = () => reloadOutbox();
    const goOnline = () => {
      setOnline(true);
      syncNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('sg-outbox-changed', onChange);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = setInterval(() => {
      if (getOutbox(userId).some((i) => i.status === 'PENDING')) syncNow();
    }, 60_000);
    // Opportunistic sync on load.
    if (getOutbox(userId).some((i) => i.status === 'PENDING')) syncNow();
    return () => {
      window.removeEventListener('sg-outbox-changed', onChange);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(timer);
    };
  }, [userId, reloadOutbox, refreshDashboard, syncNow]);

  // Realtime: approvals, verifications and assignments refresh the dashboard.
  useEffect(() => {
    if (lastEvent) refreshDashboard();
  }, [lastEvent, refreshDashboard]);

  const submit = useCallback<FieldContextValue['submit']>(
    async ({ url, body, type, label, idempotencyKey }) => {
      const payload = { ...body, idempotencyKey };
      try {
        const data = await apiJson(url, { method: 'POST', json: payload });
        refreshDashboard();
        return { ok: true, offline: false, data };
      } catch (err) {
        if (isNetworkError(err)) {
          enqueue(userId, type, body, label, idempotencyKey);
          reloadOutbox();
          return { ok: true, offline: true };
        }
        return { ok: false, error: errorMessage(err) };
      }
    },
    [userId, reloadOutbox, refreshDashboard]
  );

  const startDay = useCallback<FieldContextValue['startDay']>(
    async (opts = {}) => {
      const { fix, error } = await getCurrentFix();
      if (!fix && !opts.allowWithoutLocation) return { ok: false, error: error || 'Location unavailable', locationError: error };
      const body = { latitude: fix?.latitude, longitude: fix?.longitude, deviceId: deviceId(), timestamp: new Date().toISOString() };
      const res = await submit({ url: '/api/attendance/start', body, type: 'START_DAY', label: 'Start day', idempotencyKey: `start-day-${newId()}` });
      if (!res.ok && /already ON DUTY/i.test(res.error)) {
        await refreshDashboard();
        return { ok: true, offline: false };
      }
      await refreshDashboard();
      return { ...res, locationError: fix ? undefined : error } as ActionResult & { locationError?: string };
    },
    [submit, refreshDashboard]
  );

  const endDay = useCallback<FieldContextValue['endDay']>(async () => {
    await trackerRef.current?.flush();
    const { fix } = await getCurrentFix(8000);
    const body = { latitude: fix?.latitude, longitude: fix?.longitude, timestamp: new Date().toISOString() };
    try {
      const data = await apiJson<{ data: any }>('/api/attendance/end', { method: 'POST', json: body });
      await trackerRef.current?.stop();
      await refreshDashboard();
      return { ok: true, offline: false, data: data.data };
    } catch (err) {
      if (isNetworkError(err)) {
        enqueue(userId, 'END_DAY', body, 'End day', `end-day-${newId()}`);
        reloadOutbox();
        await trackerRef.current?.stop({ flush: false });
        return { ok: true, offline: true };
      }
      await refreshDashboard();
      return { ok: false, error: errorMessage(err) };
    }
  }, [userId, reloadOutbox, refreshDashboard]);

  const value: FieldContextValue = {
    dashboard,
    dashboardError,
    refreshDashboard,
    dutyStatus,
    dutyPendingSync: pendingDuty !== null,
    tracking,
    setWakeLock: async (on) => trackerRef.current?.setWakeLock(on),
    outbox,
    online,
    syncing,
    syncNow,
    discardOutboxItem: (id) => {
      removeItem(userId, id);
      reloadOutbox();
    },
    startDay,
    endDay,
    submit,
    currentFix: () => getCurrentFix(),
    settings,
  };
  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
}

export function useField() {
  const ctx = useContext(FieldContext);
  if (!ctx) throw new Error('useField must be used within FieldProvider');
  return ctx;
}

/** Clears this user's queued data from the device (on explicit sign-out). */
export function clearFieldData(userId: string) {
  removeKeys(`sg_outbox_${userId}`);
  removeKeys(`sg_gps_buffer_${userId}`);
  removeKeys(`sg_visit_${userId}`);
  removeKeys(`sg_cache_${userId}`);
}

export { updateItems };
