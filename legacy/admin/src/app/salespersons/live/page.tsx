'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/layout/AdminShell';
import LiveMap from '@/components/maps/LiveMap';
import StatusBadge from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import {
  Navigation2,
  Battery,
  Zap,
  Clock,
  Radio,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';

export default function LiveTrackingPage() {
  const { token } = useAuth();
  const { socket, isConnected, lastEvent } = useSocket();
  const [trackers, setTrackers] = useState<any[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [filterDuty, setFilterDuty] = useState<'ALL' | 'ON_DUTY' | 'OFF_DUTY'>('ALL');

  const fetchTrackingData = async () => {
    if (!token) return;
    try {
      const [currentRes, statusRes] = await fetch('/api/location/current', {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (r) => [
        await r.json(),
        await fetch('/api/salespersons/live-status', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((s) => s.json()),
      ]);

      setTrackers(currentRes.data || []);
      setLiveStatuses(statusRes.data || []);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrackingData();
    const interval = setInterval(fetchTrackingData, 15000);
    return () => clearInterval(interval);
  }, [token]);

  // Real-time socket event listener for immediate GPS point arrivals
  useEffect(() => {
    if (!socket) return;

    const handleLocationUpdate = (envelope: any) => {
      const point = envelope.data || envelope;
      setTrackers((prev) => {
        const idx = prev.findIndex((t) => t.salespersonId === point.salespersonId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...point, updatedAt: new Date().toISOString() };
          return updated;
        }
        return [point, ...prev];
      });
      setLastRefreshed(new Date());
    };

    socket.on('location:update', handleLocationUpdate);
    socket.on('attendance:changed', () => fetchTrackingData());

    return () => {
      socket.off('location:update', handleLocationUpdate);
      socket.off('attendance:changed');
    };
  }, [socket]);

  const filteredStatuses = liveStatuses.filter((s) => {
    if (filterDuty === 'ON_DUTY') return s.dutyStatus === 'ON_DUTY';
    if (filterDuty === 'OFF_DUTY') return s.dutyStatus !== 'ON_DUTY';
    return true;
  });

  return (
    <AdminShell title="Live Field Tracking">
      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)] max-w-7xl">
        {/* Left Side: Real-time map */}
        <div className="flex-1 bg-white rounded-xl border border-[#CBD2D7] overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[#CBD2D7] flex items-center justify-between bg-[#F3F5F6]/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2E6819] animate-pulse" />
              <span className="text-xs font-bold text-[#0B1320] uppercase tracking-wider">
                Live Field Coverage Map
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#586570]">
                Auto-refreshing (10s) • {lastRefreshed.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
              </span>
              <button
                onClick={fetchTrackingData}
                className="p-1.5 text-[#586570] hover:text-[#0B1320] hover:bg-[#E2E7EC] rounded-md transition-colors"
                title="Refresh now"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 relative">
            <LiveMap salespersons={trackers} />
          </div>
        </div>

        {/* Right Side: Salespersons Live Status Feed */}
        <div className="w-full lg:w-96 bg-white rounded-xl border border-[#CBD2D7] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#CBD2D7] bg-[#F3F5F6]/60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[#0B1320]">Salesperson Feed</h3>
              <span className="text-xs font-semibold text-[#2E6819] bg-[#E6F4DD] border border-[#B4E39C] px-2 py-0.5 rounded-full">
                {liveStatuses.filter((s) => s.dutyStatus === 'ON_DUTY').length} On Duty
              </span>
            </div>

            <div className="flex gap-1.5">
              {(['ALL', 'ON_DUTY', 'OFF_DUTY'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setFilterDuty(mode)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    filterDuty === mode
                      ? 'bg-[#081224] text-white border-[#081224]'
                      : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
                  }`}
                >
                  {mode.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {loading ? (
              <div className="p-8 text-center text-xs text-[#80909D]">Loading live trackers...</div>
            ) : filteredStatuses.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#80909D]">No salespersons matching filter.</div>
            ) : (
              filteredStatuses.map((sp) => (
                <div
                  key={sp.id}
                  className="p-3.5 rounded-xl border border-[#CBD2D7] bg-[#F3F5F6] hover:bg-white hover:border-[#081224] transition-all space-y-2.5"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-[#0B1320] flex items-center gap-1.5">
                        <span>{sp.salespersonName}</span>
                        <span className="text-[10px] font-normal text-[#586570]">({sp.employeeCode})</span>
                      </h4>
                      <p className="text-[11px] text-[#586570] mt-0.5">{sp.territory}</p>
                    </div>
                    <StatusBadge status={sp.dutyStatus} />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#586570] pt-2 border-t border-[#E2E7EC]">
                    <div className="flex items-center gap-2">
                      {sp.batteryLevel !== null && (
                        <span className="flex items-center gap-1 font-mono">
                          <Battery className="w-3 h-3 text-[#2E6819]" />
                          {sp.batteryLevel}%
                        </span>
                      )}
                      {sp.speed !== null && (
                        <span className="flex items-center gap-1 font-mono">
                          <Zap className="w-3 h-3 text-[#081224]" />
                          {sp.speed} km/h
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#80909D]">{sp.lastUpdateFormatted}</span>
                  </div>

                  {sp.lastLatitude && sp.lastLongitude && (
                    <div className="text-[10px] font-mono text-[#586570] bg-white p-1.5 rounded border border-[#E2E7EC] truncate">
                      GPS: {sp.lastLatitude.toFixed(4)}, {sp.lastLongitude.toFixed(4)}
                    </div>
                  )}

                  <div className="pt-1 flex justify-end">
                    <Link
                      href={`/salespersons/route?salespersonId=${sp.id}`}
                      className="text-[11px] text-[#259DC3] hover:underline flex items-center gap-1"
                    >
                      <span>Route History</span>
                      <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
