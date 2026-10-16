'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Menu, Radio } from 'lucide-react';
import { useSession } from '@/components/shared/SessionProvider';
import { useSocket } from '@/components/shared/RealtimeProvider';
import { apiFetch } from '@/lib/client/apiFetch';

const TZ = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata';

export default function Header({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { hasPermission } = useSession();
  const { isConnected, connectionStatus, lastEvent } = useSocket();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await apiFetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount || 0);
        setNotifications(data.data || []);
      }
    } catch {
      /* offline: keep last state */
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (lastEvent) load();
  }, [lastEvent]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => panelRef.current && !panelRef.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAllRead = async () => {
    const res = await apiFetch('/api/notifications/read-all', { method: 'PUT' });
    if (res.ok) {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  return (
    <header className="h-[64px] lg:h-[72px] bg-white border-b border-[#CBD2D7] px-4 md:px-8 flex items-center justify-between gap-3 sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        <button className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-[#F3F5F6]" onClick={onMenu} aria-label="Open navigation" aria-controls="console-nav">
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-base md:text-xl font-semibold text-[#0B1320] tracking-tight truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <div
          title={`Realtime connection: ${connectionStatus}`}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            isConnected ? 'bg-[#E6F4DD] text-[#2E6819] border-[#B4E39C]' : connectionStatus === 'connecting' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>{isConnected ? 'Live' : connectionStatus === 'connecting' ? 'Connecting…' : 'Offline · polling'}</span>
        </div>

        {hasPermission('canViewGps') && (
          <Link href="/salespersons/live" className="hidden md:inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-white text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6]">
            <span className="w-2 h-2 rounded-full bg-[#2E6819]" />
            Live Field Map
          </Link>
        )}

        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setOpen(!open)}
            className="p-2 rounded-lg text-[#586570] hover:text-[#0B1320] hover:bg-[#F3F5F6] relative"
            aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
            aria-expanded={open}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-[#081224] text-white text-[10px] font-bold rounded-full flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] bg-white border border-[#CBD2D7] rounded-xl shadow-lg py-2 z-50">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E7EC]">
                <span className="text-xs font-semibold text-[#0B1320]">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[11px] text-[#259DC3] hover:underline">Mark all read</button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-[#E2E7EC]">
                {notifications.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[#80909D]">No recent notifications</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className={`p-3 text-xs ${n.read ? 'bg-white' : 'bg-[#F3F5F6]'}`}>
                      <p className="font-semibold text-[#0B1320]">{n.title}</p>
                      <p className="text-[#586570] mt-0.5 break-words">{n.message}</p>
                      <p className="text-[10px] text-[#80909D] mt-1">{new Date(n.createdAt).toLocaleString('en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
