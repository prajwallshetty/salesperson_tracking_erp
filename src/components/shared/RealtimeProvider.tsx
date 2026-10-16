'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@/lib/domain/constants';
import { useSession } from './SessionProvider';

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
}

const RealtimeContext = createContext<RealtimeValue>({ socket: null, isConnected: false, connectionStatus: 'disconnected', lastEvent: null });

const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * Same-origin Socket.IO connection authenticated by the session cookie. When the realtime
 * server is unavailable, pages keep working through their polling refresh.
 */
export function RealtimeProvider({ children, toasts = true }: { children: React.ReactNode; toasts?: boolean }) {
  const { user } = useSession();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>('disconnected');
  const [lastEvent, setLastEvent] = useState<LastEvent | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string; tone: 'info' | 'success' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!user) return;
    setStatus('connecting');
    const s = io({ withCredentials: true, transports: ['websocket', 'polling'], reconnectionAttempts: 20, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });
    s.on('connect', () => setStatus('connected'));
    s.on('disconnect', () => setStatus('disconnected'));
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
    on(SOCKET_EVENTS.CLIENT_ASSIGNED);
    on(SOCKET_EVENTS.NOTIFICATION_NEW);

    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [user, toasts]);

  return (
    <RealtimeContext.Provider value={{ socket, isConnected: status === 'connected', connectionStatus: status, lastEvent }}>
      {children}
      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:max-w-sm bg-white border border-[#CBD2D7] rounded-xl p-4 shadow-lg flex items-start gap-3">
          <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${toast.tone === 'success' ? 'bg-[#2E6819]' : 'bg-[#081224]'}`} />
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
