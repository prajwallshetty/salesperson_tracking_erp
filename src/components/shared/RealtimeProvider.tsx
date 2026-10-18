'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@/lib/domain/constants';
import { useSession } from './SessionProvider';
import { showBackgroundNotification } from '@/lib/native/notify';

type Status = 'connected' | 'connecting' | 'disconnected' | 'error';
interface LastEvent {
  eventName: string;
  payload: any;
  timestamp: string;
}
interface RealtimeValue {
  socket: Socket | null;
  isConnected: boolean;
  connectionStatus: Status;
  lastEvent: LastEvent | null;
  /** Counts of events received per event name (never loses an event when several arrive together). */
  eventVersions: Record<string, number>;
  /** Increases whenever data may have been missed: socket reconnected, network returned, tab visible again after a while. */
  resyncToken: number;
}

const RealtimeContext = createContext<RealtimeValue>({ socket: null, isConnected: false, connectionStatus: 'disconnected', lastEvent: null, eventVersions: {}, resyncToken: 0 });

/** The tab must have been hidden at least this long before coming back counts as "may have missed events". */
const RESYNC_AFTER_HIDDEN_MS = 20_000;

const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * Same-origin Socket.IO connection authenticated by the session cookie. When the realtime
 * server is unavailable, pages keep working through their polling refresh.
 */
export function RealtimeProvider({ children, toasts = true }: { children: React.ReactNode; toasts?: boolean }) {
  const { user, refreshUser } = useSession();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>('disconnected');
  const [lastEvent, setLastEvent] = useState<LastEvent | null>(null);
  const [eventVersions, setEventVersions] = useState<Record<string, number>>({});
  const [resyncToken, setResyncToken] = useState(0);
  const bump = useCallback(() => setResyncToken((n) => n + 1), []);
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;
  const [toast, setToast] = useState<{ title: string; message: string; tone: 'info' | 'success' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!user) return;
    setStatus('connecting');
    const s = io({ withCredentials: true, transports: ['websocket', 'polling'], reconnectionAttempts: 20, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });
    // Anything that happened while we were disconnected was never delivered: tell pages to refetch.
    let connectedBefore = false;
    s.on('connect', () => {
      setStatus('connected');
      if (connectedBefore) bump();
      connectedBefore = true;
    });
    s.on('disconnect', () => setStatus('disconnected'));
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt !== null && Date.now() - hiddenAt > RESYNC_AFTER_HIDDEN_MS) {
        hiddenAt = null;
        bump();
      } else hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', bump);
    s.on('connect_error', () => setStatus('error'));

    const show = (title: string, message: string, tone: 'info' | 'success' = 'info') => {
      if (!toasts) return;
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ title, message, tone });
      toastTimer.current = setTimeout(() => setToast(null), 5000);
    };
    const on = (event: string, handler?: (d: any) => void) =>
      s.on(event, (env: any) => {
        const data = env?.data ?? env;
        setLastEvent({ eventName: event, payload: data, timestamp: env?.timestamp || new Date().toISOString() });
        setEventVersions((v) => ({ ...v, [event]: (v[event] ?? 0) + 1 }));
        handler?.(data);
      });

    on(SOCKET_EVENTS.ORDER_CREATED, (o) => show('New order placed', `Order #${o.orderNumber} for ${inr(o.grandTotal)}${o.clientName ? ` — ${o.clientName}` : ''}`, 'success'));
    on(SOCKET_EVENTS.ORDER_STATUS_CHANGED, (o) => show('Order updated', `Order #${o.orderNumber} is now ${o.status}`));
    on(SOCKET_EVENTS.PAYMENT_COLLECTED, (p) => show('Payment collected', `${inr(p.amount)} by ${p.salesperson?.user?.name || 'field staff'}`, 'success'));
    on(SOCKET_EVENTS.PAYMENT_VERIFIED, (p) => show('Collection reviewed', `${p.receiptNumber} marked ${p.status}`));
    on(SOCKET_EVENTS.EXPENSE_SUBMITTED, (e) => show('New expense claim', `${e.salesperson?.user?.name || 'Staff'} submitted ${inr(e.amount)}`));
    on(SOCKET_EVENTS.EXPENSE_APPROVED);
    on(SOCKET_EVENTS.EXPENSE_REJECTED);
    on(SOCKET_EVENTS.EXPENSE_REIMBURSED);
    on(SOCKET_EVENTS.ATTENDANCE_CHANGED, (a) =>
      show(a.attendance?.dutyStatus === 'ON_DUTY' ? 'Day started' : 'Day ended', `${a.attendance?.salespersonName || 'A salesperson'} is now ${a.attendance?.dutyStatus === 'ON_DUTY' ? 'on duty' : 'off duty'}`)
    );
    on(SOCKET_EVENTS.LOCATION_UPDATE);
    on(SOCKET_EVENTS.TRACKING_STATE);
    on(SOCKET_EVENTS.CLIENT_ASSIGNED);
    on(SOCKET_EVENTS.CLIENT_CHANGED);
    on(SOCKET_EVENTS.PRODUCT_CHANGED);
    on(SOCKET_EVENTS.SETTINGS_CHANGED);
    on(SOCKET_EVENTS.TEAM_CHANGED);
    // Permissions are enforced by the server on every request; this only refreshes what the UI shows.
    on(SOCKET_EVENTS.PERMISSIONS_CHANGED, () => void refreshUserRef.current());
    on(SOCKET_EVENTS.NOTIFICATION_NEW, (n) => void showBackgroundNotification(n?.title || 'Bharath Interior Decor', n?.message || ''));

    setSocket(s);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', bump);
      s.disconnect();
      setSocket(null);
    };
  }, [user, toasts, bump]);

  return (
    <RealtimeContext.Provider value={{ socket, isConnected: status === 'connected', connectionStatus: status, lastEvent, eventVersions, resyncToken }}>
      {children}
      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:max-w-sm bg-white border border-[#CBD2D7] rounded-xl p-4 shadow-lg flex items-start gap-3">
          <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${toast.tone === 'success' ? 'bg-[#2E6819]' : 'bg-[#000000]'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-[#0B1320]">{toast.title}</p>
            <p className="text-xs text-[#586570] mt-0.5 break-words">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} aria-label="Dismiss notification" className="text-[#8C9BA5] hover:text-[#0B1320] text-xs">✕</button>
        </div>
      )}
    </RealtimeContext.Provider>
  );
}

export function useSocket() {
  return useContext(RealtimeContext);
}

/**
 * Re-runs `refetch` when any of `events` arrives (nothing is lost when several arrive at once) and
 * whenever data may have been missed: after the socket reconnects, the network returns, or the tab
 * is visible again after a while. Pages keep their own polling as a fallback.
 */
export function useRealtimeRefresh(refetch: () => void, events: readonly string[] = []) {
  const { eventVersions, resyncToken } = useSocket();
  const ref = useRef(refetch);
  ref.current = refetch;
  const key = events.map((e) => eventVersions[e] ?? 0).join(',');
  const firstKey = useRef(key);
  useEffect(() => {
    if (key !== firstKey.current) ref.current();
    // `events` is a stable literal at each call site; the counters in `key` are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (resyncToken > 0) ref.current();
  }, [resyncToken]);
}
