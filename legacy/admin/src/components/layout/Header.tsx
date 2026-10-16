'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bell, Navigation, Clock, Radio } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';

export default function Header({ title }: { title: string }) {
  const { token } = useAuth();
  const { isConnected, connectionStatus, lastEvent } = useSocket();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [currentTime, setCurrentTime] = useState('');

  const fetchNotifications = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount || 0);
        setNotifications(data.data || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, [token]);

  // Instantly re-fetch when socket emits any business event
  useEffect(() => {
    if (lastEvent) {
      fetchNotifications();
    }
  }, [lastEvent]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const tInterval = setInterval(updateTime, 1000);
    return () => clearInterval(tInterval);
  }, []);

  const markAllRead = async () => {
    if (!token) return;
    try {
      await fetch('/api/notifications/read-all', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <header className="h-[72px] bg-white border-b border-[#CBD2D7] px-6 md:px-8 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <h2 className="text-lg md:text-xl font-semibold text-[#0B1320] tracking-tight">{title}</h2>
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E6F4DD] text-[#2E6819] border border-[#B4E39C]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2E6819]" />
          IST Live
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-[#586570] font-mono bg-[#F3F5F6] px-3 py-1.5 rounded-lg border border-[#E2E7EC]">
          <Clock className="w-3.5 h-3.5 text-[#80909D]" />
          <span>{currentTime || 'Syncing clock...'}</span>
        </div>

        {/* Real-time Socket Indicator */}
        <div
          title={`Socket connection: ${connectionStatus}`}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            isConnected
              ? 'bg-[#E6F4DD] text-[#2E6819] border-[#B4E39C]'
              : connectionStatus === 'connecting'
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected
                ? 'bg-[#2E6819] animate-pulse'
                : connectionStatus === 'connecting'
                ? 'bg-amber-500 animate-ping'
                : 'bg-rose-500'
            }`}
          />
          <Radio className="w-3 h-3 stroke-[2]" />
          <span>{isConnected ? 'Socket Live' : connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}</span>
        </div>

        <Link
          href="/salespersons/live"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs md:text-sm font-medium bg-white text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] transition-colors"
        >
          <div className="w-2 h-2 rounded-full bg-[#2E6819]" />
          <span>Live Field Map</span>
        </Link>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-lg text-[#586570] hover:text-[#0B1320] hover:bg-[#F3F5F6] border border-transparent hover:border-[#CBD2D7] relative transition-colors"
            aria-label="View notifications"
          >
            <Bell className="w-4 h-4 stroke-[1.75]" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-[#081224] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-[#CBD2D7] rounded-xl shadow-lg py-2 z-50 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E7EC]">
                <span className="text-xs font-semibold text-[#0B1320]">System Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[11px] text-[#259DC3] hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-[#E2E7EC]">
                {notifications.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#80909D]">No recent notifications</div>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className={`p-3 text-xs ${n.read ? 'bg-white' : 'bg-[#F3F5F6]'}`}>
                      <p className="font-semibold text-[#0B1320]">{n.title}</p>
                      <p className="text-[#586570] mt-0.5">{n.message}</p>
                      <p className="text-[10px] text-[#80909D] mt-1">
                        {new Date(n.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </p>
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
