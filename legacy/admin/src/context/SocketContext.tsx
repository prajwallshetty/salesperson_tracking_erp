'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { SOCKET_EVENTS } from '@/shared';
import { SOCKET_URL } from '../config/api';

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastEvent: { eventName: string; payload: any; timestamp: string } | null;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  connectionStatus: 'disconnected',
  lastEvent: null,
});

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'error'>('disconnected');
  const [lastEvent, setLastEvent] = useState<{ eventName: string; payload: any; timestamp: string } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [liveToast, setLiveToast] = useState<{ title: string; message: string; type: 'info' | 'success' | 'warning' } | null>(null);

  useEffect(() => {
    if (!token) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
        setConnectionStatus('disconnected');
      }
      return;
    }

    const socketUrl = SOCKET_URL;
    setConnectionStatus('connecting');

    const s = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    s.on('connect', () => {
      setIsConnected(true);
      setConnectionStatus('connected');
      console.log('Socket.IO connected to backend:', s.id);
    });

    s.on('disconnect', (reason) => {
      setIsConnected(false);
      setConnectionStatus('disconnected');
      console.log('Socket.IO disconnected:', reason);
    });

    s.on('connect_error', (err) => {
      setIsConnected(false);
      setConnectionStatus('error');
      console.warn('Socket.IO connection error:', err.message);
    });

    // Universal Event Listener Helper
    const registerEvent = (eventName: string, handler: (data: any) => void) => {
      s.on(eventName, (envelope: any) => {
        setLastEvent({
          eventName,
          payload: envelope.data || envelope,
          timestamp: envelope.timestamp || new Date().toISOString(),
        });
        handler(envelope.data || envelope);
      });
    };

    // Real-Time Event Handlers for live alerts
    registerEvent(SOCKET_EVENTS.ORDER_CREATED, (order) => {
      showToast('New Order Placed', `Order #${order.orderNumber} for ₹${Number(order.totalAmount).toLocaleString('en-IN')}`, 'success');
    });

    registerEvent(SOCKET_EVENTS.PAYMENT_COLLECTED, (payment) => {
      showToast('Payment Collected', `₹${Number(payment.amount).toLocaleString('en-IN')} collected by ${payment.salesperson?.user?.name || 'staff'}`, 'success');
    });

    registerEvent(SOCKET_EVENTS.EXPENSE_SUBMITTED, (expense) => {
      showToast('New Expense Claim', `${expense.salesperson?.user?.name || 'Staff'} submitted ₹${Number(expense.amount).toLocaleString('en-IN')} (${expense.category})`, 'info');
    });

    registerEvent(SOCKET_EVENTS.ATTENDANCE_CHANGED, (attendance) => {
      const type = attendance.status === 'ACTIVE' ? 'Started Day' : 'Ended Day';
      showToast(`Duty Status: ${type}`, `${attendance.salesperson?.user?.name || 'Staff'} has ${type.toLowerCase()}`, 'info');
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token]);

  const showToast = (title: string, message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setLiveToast({ title, message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setLiveToast(null);
    }, 5000);
  };

  return (
    <SocketContext.Provider value={{ socket, isConnected, connectionStatus, lastEvent }}>
      {children}
      {/* Live Toast Alert */}
      {liveToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-white border border-[#CBD2D7] rounded-xl p-4 shadow-lg flex items-start gap-3 transition-all animate-bounce-in">
          <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
            liveToast.type === 'success' ? 'bg-[#2E6819]' : liveToast.type === 'warning' ? 'bg-[#D97706]' : 'bg-[#081224]'
          }`} />
          <div className="flex-1">
            <h4 className="text-xs font-bold text-[#0B1320] tracking-tight">{liveToast.title}</h4>
            <p className="text-xs text-[#586570] mt-0.5">{liveToast.message}</p>
          </div>
          <button
            onClick={() => setLiveToast(null)}
            className="text-[#8C9BA5] hover:text-[#0B1320] text-xs font-medium"
          >
            ✕
          </button>
        </div>
      )}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
