'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Menu, Radio, Zap, ShieldCheck, Briefcase, Smartphone, ChevronDown, Check } from 'lucide-react';
import { useSession } from '@/components/shared/SessionProvider';
import { useSocket } from '@/components/shared/RealtimeProvider';
import { apiFetch } from '@/lib/client/apiFetch';

const TZ = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata';

export default function Header({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { user, hasPermission } = useSession();
  const { isConnected, connectionStatus, lastEvent } = useSocket();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!switchOpen) return;
    const onDown = (e: MouseEvent) => switchRef.current && !switchRef.current.contains(e.target as Node) && setSwitchOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSwitchOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [switchOpen]);

  const switchRole = async (targetRole: 'SUPER_ADMIN' | 'MANAGER' | 'SALESPERSON') => {
    setSwitching(true);
    const credentials = {
      SUPER_ADMIN: { identifier: 'admin@erp.com', password: 'Password123!' },
      MANAGER: { identifier: 'manager@erp.com', password: 'Password123!' },
      SALESPERSON: { identifier: 'rahul@erp.com', password: 'Password123!' },
    };
    const cred = credentials[targetRole];
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cred.identifier, password: cred.password, remember: true }),
      });
      if (res.ok) {
        window.location.assign(targetRole === 'SALESPERSON' ? '/field' : '/dashboard');
      } else {
        setSwitching(false);
      }
    } catch {
      setSwitching(false);
    }
  };

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

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {/* Quick Demo Role Switcher */}
        <div className="relative" ref={switchRef}>
          <button
            onClick={() => setSwitchOpen(!switchOpen)}
            disabled={switching}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-50/90 to-sky-50/90 border border-indigo-200/90 text-indigo-950 hover:border-indigo-400 hover:shadow-xs transition-all cursor-pointer disabled:opacity-50"
            title="Quick switch demo role"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
            <span className="hidden sm:inline text-[#586570]">Demo:</span>
            <span className="font-bold text-indigo-700">
              {user?.role === 'SUPER_ADMIN' ? 'Admin' : user?.role === 'MANAGER' ? 'Manager' : 'Salesperson'}
            </span>
            <ChevronDown className="w-3 h-3 text-indigo-500 shrink-0" />
          </button>
          {switchOpen && (
            <div className="absolute right-0 mt-2 w-60 bg-white border border-[#CBD2D7] rounded-xl shadow-lg py-1.5 z-50">
              <div className="px-3 py-1.5 border-b border-[#E2E7EC] flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#586570] uppercase tracking-wider">Quick Role Switch</span>
                <span className="text-[9px] text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">1-Tap</span>
              </div>
              <button
                type="button"
                onClick={() => switchRole('SUPER_ADMIN')}
                className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-indigo-50/70 transition-colors ${user?.role === 'SUPER_ADMIN' ? 'bg-indigo-50/40' : ''}`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#0B1320]">Admin</p>
                    <p className="text-[10px] text-[#586570]">Full ERP console</p>
                  </div>
                </div>
                {user?.role === 'SUPER_ADMIN' && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
              </button>
              <button
                type="button"
                onClick={() => switchRole('MANAGER')}
                className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-sky-50/70 transition-colors ${user?.role === 'MANAGER' ? 'bg-sky-50/40' : ''}`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-sky-100 flex items-center justify-center text-sky-700 shrink-0">
                    <Briefcase className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#0B1320]">Manager</p>
                    <p className="text-[10px] text-[#586570]">Team & approvals</p>
                  </div>
                </div>
                {user?.role === 'MANAGER' && <Check className="w-4 h-4 text-sky-600 shrink-0" />}
              </button>
              <button
                type="button"
                onClick={() => switchRole('SALESPERSON')}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-emerald-50/70 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                    <Smartphone className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#0B1320]">Field Sales</p>
                    <p className="text-[10px] text-[#586570]">Mobile field app</p>
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

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
