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
import { useAuth } from '@/components/shared/SessionProvider';
import { apiFetch } from '@/lib/client/apiFetch';
import { useSocket, useRealtimeRefresh } from '@/components/shared/RealtimeProvider';
import { SOCKET_EVENTS } from '@/lib/domain/constants';
import { computeLiveState, type LiveState } from '@/features/tracking/liveState';

const STATE_STYLE: Record<LiveState, { dot: string; text: string; bg: string; border: string }> = {
  live: { dot: 'bg-[#2E6819]', text: 'text-[#2E6819]', bg: 'bg-[#E6F4DD]', border: 'border-[#B4E39C]' },
  stale: { dot: 'bg-[#B45309]', text: 'text-[#92400E]', bg: 'bg-[#FEF3C7]', border: 'border-[#FDE68A]' },
  unavailable: { dot: 'bg-[#80909D]', text: 'text-[#586570]', bg: 'bg-[#F3F5F6]', border: 'border-[#CBD2D7]' },
  permission_denied: { dot: 'bg-[#991B1B]', text: 'text-[#991B1B]', bg: 'bg-[#FDF2F2]', border: 'border-[#F8C4C4]' },
  gps_disabled: { dot: 'bg-[#991B1B]', text: 'text-[#991B1B]', bg: 'bg-[#FDF2F2]', border: 'border-[#F8C4C4]' },
  off_duty: { dot: 'bg-[#80909D]', text: 'text-[#586570]', bg: 'bg-[#F3F5F6]', border: 'border-[#CBD2D7]' },
};

export default function LiveTrackingPage() {
  const { token } = useAuth();
  const { socket, isConnected, lastEvent } = useSocket();
  const [trackers, setTrackers] = useState<any[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [filterDuty, setFilterDuty] = useState<'ALL' | 'ON_DUTY' | 'OFF_DUTY'>('ALL');
  // Re-evaluate "live vs stale" every 20 s from the real fix times, so a marker never stays "live" just because nothing arrived.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);

  const fetchTrackingData = async () => {
    if (!token) return;
    try {
      const [currentRes, statusRes] = await apiFetch('/api/location/current').then(async (r) => [
        await r.json(),
        await apiFetch('/api/salespersons/live-status').then((s) => s.json()),
      ]);

      // A fetch that started before a newer fix arrived over the socket must not roll the position back:
      // keep whichever position is newer, take everything else (duty, device state) from the server.
      const newer = (a?: string, b?: string) => Boolean(a) && (!b || new Date(a!).getTime() > new Date(b).getTime());
      setTrackers((prev) =>
        (currentRes.data || []).map((t: any) => {
          const p = prev.find((x) => x.salespersonId === t.salespersonId);
          return newer(p?.currentLocation?.timestamp, t.currentLocation?.timestamp) ? { ...t, currentLocation: p.currentLocation } : t;
        })
      );
      setLiveStatuses((prev) =>
        (statusRes.data || []).map((st: any) => {
          const p = prev.find((x) => x.id === st.id);
          return newer(p?.lastUpdate, st.lastUpdate)
            ? { ...st, lastLatitude: p.lastLatitude, lastLongitude: p.lastLongitude, accuracy: p.accuracy, speed: p.speed, batteryLevel: p.batteryLevel, lastUpdate: p.lastUpdate }
            : st;
        })
      );
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

    // Envelope data is { salespersonId, point } — move that tracker's marker immediately.
    const handleLocationUpdate = (envelope: any) => {
      const { salespersonId, point } = envelope?.data || {};
      if (!salespersonId || !point) return;
      setTrackers((prev) =>
        prev.map((t) => (t.salespersonId === salespersonId ? { ...t, currentLocation: { ...t.currentLocation, ...point }, isOnline: true } : t))
      );
      // Position and fix time come from the fix itself; the state is re-derived from that time (never "just now" by assumption).
      setLiveStatuses((prev) =>
        prev.map((s) =>
          s.id === salespersonId
            ? { ...s, lastLatitude: point.latitude, lastLongitude: point.longitude, accuracy: point.accuracy ?? null, speed: point.speed ?? null, batteryLevel: point.batteryLevel ?? null, lastUpdate: point.timestamp }
            : s
        )
      );
      setLastRefreshed(new Date());
    };

    socket.on(SOCKET_EVENTS.LOCATION_UPDATE, handleLocationUpdate);

    return () => {
      socket.off(SOCKET_EVENTS.LOCATION_UPDATE, handleLocationUpdate);
    };
  }, [socket]);

  // Duty changes, device-reported permission/GPS problems, team changes, and anything missed while
  // disconnected or in the background: refetch the authoritative state.
  useRealtimeRefresh(fetchTrackingData, [SOCKET_EVENTS.ATTENDANCE_CHANGED, SOCKET_EVENTS.TRACKING_STATE, SOCKET_EVENTS.TEAM_CHANGED]);

  const withLive = (s: any) =>
    computeLiveState({ dutyStatus: s.dutyStatus, lastFixAt: s.lastUpdate, deviceState: s.deviceTrackingState, deviceStateAt: s.deviceTrackingStateAt, now });
  const statusById = new Map(liveStatuses.map((s) => [s.id, s]));
  const mapData = trackers.map((t) => {
    const st = statusById.get(t.salespersonId);
    const live = computeLiveState({
      dutyStatus: t.dutyStatus,
      lastFixAt: t.currentLocation?.timestamp,
      deviceState: st?.deviceTrackingState,
      deviceStateAt: st?.deviceTrackingStateAt,
      now,
    });
    return { ...t, isOnline: live.state === 'live', liveState: live.state, liveStateLabel: live.label };
  });

  const formatAgeFrom = (iso: string, at: Date) => {
    const min = Math.max(0, Math.floor((at.getTime() - new Date(iso).getTime()) / 60000));
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.floor(min / 60)}h ago` : `${Math.floor(min / 1440)}d ago`;
  };

  const filteredStatuses = liveStatuses.filter((s) => {
    if (filterDuty === 'ON_DUTY') return s.dutyStatus === 'ON_DUTY';
    if (filterDuty === 'OFF_DUTY') return s.dutyStatus !== 'ON_DUTY';
    return true;
  });

  return (
    <AdminShell title="Live Field Tracking">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-140px)] max-w-7xl">
        {/* Left Side: Real-time map */}
        <div className="flex-1 bg-white rounded-xl border border-[#CBD2D7] overflow-hidden flex flex-col h-[60vh] lg:h-auto min-h-[320px]">
          <div className="p-4 border-b border-[#CBD2D7] flex items-center justify-between bg-[#F3F5F6]/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2E6819] animate-pulse" />
              <span className="text-xs font-bold text-[#0B1320] uppercase tracking-wider">
                Live Field Coverage Map
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#586570]">
                {isConnected ? 'Live updates' : 'Polling every 15s'}{lastRefreshed ? ` • ${lastRefreshed.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}
              </span>
              <button
                onClick={fetchTrackingData}
                className="p-1.5 text-[#586570] hover:text-[#0B1320] hover:bg-[#E2E7EC] rounded-md transition-colors"
                aria-label="Refresh now"
                title="Refresh now"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 relative">
            <LiveMap salespersons={mapData} />
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

                  {(() => {
                    const live = withLive(sp);
                    const st = STATE_STYLE[live.state];
                    return (
                      <div role="status" data-live-state={live.state} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${st.bg} ${st.border} ${st.text}`}>
                        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${st.dot} ${live.state === 'live' ? 'animate-pulse' : ''}`} />
                        <span>
                          {live.label}
                          {sp.deviceTrackingDetail && (live.state === 'permission_denied' || live.state === 'gps_disabled') ? <span className="block font-normal">{sp.deviceTrackingDetail}</span> : null}
                          {live.backgroundLimited && live.state === 'live' ? <span className="block font-normal">Foreground only: reports while the app is open</span> : null}
                        </span>
                      </div>
                    );
                  })()}

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
                    <span
                      className="text-[10px] text-[#80909D]"
                      title={sp.lastUpdate ? new Date(sp.lastUpdate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No GPS fix received'}
                    >
                      {sp.lastUpdate ? `Last fix ${formatAgeFrom(sp.lastUpdate, now)}` : 'No GPS recorded'}
                      {sp.accuracy != null ? ` · ±${Math.round(sp.accuracy)} m` : ''}
                    </span>
                  </div>

                  {sp.lastLatitude != null && sp.lastLongitude != null && (
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
