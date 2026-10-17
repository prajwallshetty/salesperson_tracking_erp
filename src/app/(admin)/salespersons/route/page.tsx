'use client';

import React, { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminShell from '@/components/layout/AdminShell';
import RouteMap, { acceptedSegments } from '@/components/maps/RouteMap';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  Calendar,
  User,
  Navigation,
  MapPin,
  Clock,
  ShoppingCart,
  CreditCard,
  Building2,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import { useAuth } from '@/components/shared/SessionProvider';
import { apiFetch } from '@/lib/client/apiFetch';
import { todayYmd } from '@/lib/client/format';
import { useRealtimeRefresh, useSocket } from '@/components/shared/RealtimeProvider';
import { SOCKET_EVENTS } from '@/lib/domain/constants';

const QUALITY: Record<string, { label: string; cls: string; hint: string }> = {
  complete: { label: 'Complete', cls: 'bg-[#E6F4DD] text-[#2E6819] border-[#B4E39C]', hint: 'Shift ended with a usable GPS record.' },
  in_progress: { label: 'In progress', cls: 'bg-[#E0F2FE] text-[#075985] border-[#BAE6FD]', hint: 'Shift is still open; the route grows as fixes arrive.' },
  incomplete: { label: 'Incomplete', cls: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]', hint: 'The shift was never ended, or fewer than two usable GPS fixes were recorded. Only what the phone reported is drawn.' },
};

const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDuration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

function RouteHistoryContent() {
  const searchParams = useSearchParams();
  const initialSpId = searchParams.get('salespersonId') || '';
  const { token } = useAuth();

  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [selectedSpId, setSelectedSpId] = useState(initialSpId);
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') || todayYmd());
  const [routeData, setRouteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const { socket } = useSocket();

  // Load salespersons list
  useEffect(() => {
    if (!token) return;
    apiFetch('/api/salespersons')
      .then((r) => r.json())
      .then((json) => {
        const list = json.data || [];
        setSalespersons(list);
        if (!selectedSpId && list.length > 0) {
          setSelectedSpId(list[0].id);
        }
      });
  }, [token]);

  // Load route history for selected salesperson & date (& optionally one shift). `silent` = live refresh, no spinner.
  const loadRoute = useCallback(
    async (silent = false) => {
      if (!token || !selectedSpId) return;
      if (!silent) setLoading(true);
      try {
        const q = selectedSessionId ? `&sessionId=${selectedSessionId}` : '';
        const res = await apiFetch(`/api/location/history?salespersonId=${selectedSpId}&date=${selectedDate}${q}`);
        setRouteData(await res.json());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [token, selectedSpId, selectedDate, selectedSessionId]
  );
  useEffect(() => {
    setSelectedSessionId('');
  }, [selectedSpId, selectedDate]);
  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  // New fixes for the person being viewed (today only) refresh the route; at most one refetch per 5 s.
  const lastLive = useRef(0);
  useEffect(() => {
    if (!socket || selectedDate !== todayYmd()) return;
    const onLocation = (env: any) => {
      if (env?.data?.salespersonId !== selectedSpId || Date.now() - lastLive.current < 5000) return;
      lastLive.current = Date.now();
      loadRoute(true);
    };
    socket.on(SOCKET_EVENTS.LOCATION_UPDATE, onLocation);
    return () => void socket.off(SOCKET_EVENTS.LOCATION_UPDATE, onLocation);
  }, [socket, selectedSpId, selectedDate, loadRoute]);
  useRealtimeRefresh(() => loadRoute(true), [SOCKET_EVENTS.ATTENDANCE_CHANGED, SOCKET_EVENTS.TRACKING_STATE]);

  // API returns segments split at tracking gaps; flagged (implausible) points are not drawn.
  const segments = acceptedSegments(routeData?.segments);
  const points = segments.flat();
  const events = routeData?.events || { visits: [], orders: [], payments: [], expenses: [] };
  const totalEvents = events.visits.length + events.orders.length + events.payments.length + (events.expenses?.length || 0);

  return (
    <AdminShell title="Daily Route History">
      <div className="space-y-6 max-w-7xl">
        {/* Top Filter Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-[#586570]">Representative:</label>
              <select
                value={selectedSpId}
                onChange={(e) => setSelectedSpId(e.target.value)}
                className="px-3 py-1.5 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
              >
                {salespersons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.employeeCode})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-[#586570]">Date:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#0B1320] bg-[#F3F5F6] border border-[#CBD2D7] px-3 py-1.5 rounded-lg">
              Est. distance: {Number(routeData?.estimatedDistanceKm || 0).toFixed(1)} km
            </span>
            <span className="text-xs font-semibold text-[#2E6819] bg-[#E6F4DD] border border-[#B4E39C] px-3 py-1.5 rounded-lg">
              {points.length} GPS points{routeData?.rejectedPointsCount ? ` · ${routeData.rejectedPointsCount} rejected` : ''}
            </span>
            {segments.length > 1 && (
              <span className="text-xs font-semibold text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] px-3 py-1.5 rounded-lg" title={routeData?.disclaimer}>
                {segments.length - 1} tracking gap{segments.length > 2 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Shifts recorded that day: honest labels, no guessing */}
        {routeData?.sessions && (
          <div className="bg-white border border-[#CBD2D7] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#CBD2D7] bg-[#F3F5F6]/60 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#0B1320]">Tracked shifts</h3>
              <div className="flex items-center gap-3 text-[11px] text-[#586570]">
                {routeData.liveState && (
                  <span className="font-semibold" data-live-state={routeData.liveState.state}>{routeData.liveState.label}</span>
                )}
                {routeData.lastKnown && (
                  <span>
                    Last known position {routeData.lastKnown.latitude.toFixed(4)}, {routeData.lastKnown.longitude.toFixed(4)} at {fmtTime(routeData.lastKnown.timestamp)}
                    {routeData.lastKnown.accuracy != null ? ` (±${Math.round(routeData.lastKnown.accuracy)} m)` : ''}
                  </span>
                )}
                {routeData.sessions.length > 1 && (
                  <select aria-label="Show one shift" value={selectedSessionId} onChange={(e) => setSelectedSessionId(e.target.value)} className="px-2 py-1 bg-white border border-[#CBD2D7] rounded-md text-[11px] font-semibold text-[#0B1320]">
                    <option value="">All shifts</option>
                    {routeData.sessions.map((s: any, i: number) => (
                      <option key={s.id} value={s.id}>Shift {i + 1} · {fmtTime(s.startedAt)}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            {routeData.sessions.length === 0 ? (
              <p className="p-5 text-xs text-[#80909D]">No tracking session was recorded for this day.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[#586570] bg-[#F3F5F6] border-b border-[#CBD2D7]">
                      <th className="py-2 px-4">Started</th>
                      <th className="py-2 px-4">Ended</th>
                      <th className="py-2 px-4">Duration</th>
                      <th className="py-2 px-4">GPS points</th>
                      <th className="py-2 px-4">Distance</th>
                      <th className="py-2 px-4">Record</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7EC]">
                    {routeData.sessions.map((s: any) => (
                      <tr key={s.id}>
                        <td className="py-2 px-4">{fmtTime(s.startedAt)}</td>
                        <td className="py-2 px-4">{s.endedAt ? fmtTime(s.endedAt) : s.quality === 'in_progress' ? 'Still open' : 'Never ended'}</td>
                        <td className="py-2 px-4">{fmtDuration(s.durationMinutes)}</td>
                        <td className="py-2 px-4">{s.acceptedPointsCount}{s.flaggedPointsCount ? <span className="text-[#92400E]"> (+{s.flaggedPointsCount} rejected)</span> : null}</td>
                        <td className="py-2 px-4">{s.distanceKm.toFixed(2)} km</td>
                        <td className="py-2 px-4">
                          <span title={QUALITY[s.quality]?.hint} className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${QUALITY[s.quality]?.cls}`}>{QUALITY[s.quality]?.label ?? s.quality}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-5 py-2 text-[11px] text-[#80909D] border-t border-[#E2E7EC]">{routeData.disclaimer}</p>
          </div>
        )}

        {/* Map & Timeline Grid */}
        <div className="flex flex-col lg:flex-row gap-6 lg:h-[calc(100vh-230px)]">
          {/* Map Canvas */}
          <div className="flex-1 bg-white rounded-xl border border-[#CBD2D7] overflow-hidden flex flex-col h-[55vh] lg:h-auto min-h-[300px]">
            <div className="p-3.5 border-b border-[#CBD2D7] bg-[#F3F5F6]/60 flex items-center justify-between text-xs">
              <span className="font-semibold text-[#0B1320]">GPS Breadcrumb Route Polyline</span>
              <span className="text-[11px] text-[#586570]">
                {points.length > 0
                  ? `First fix: ${new Date(points[0].timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`
                  : 'No GPS movement logged for this date'}
              </span>
            </div>
            <div className="flex-1 relative">
              <RouteMap segments={segments} events={events} />
            </div>
          </div>

          {/* Right Side: Timeline of Visits, Orders & Collections */}
          <div className="w-full lg:w-96 bg-white rounded-xl border border-[#CBD2D7] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[#CBD2D7] bg-[#F3F5F6]/60 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#0B1320]">Chronological Events</h3>
                <p className="text-[11px] text-[#586570]">{totalEvents} operational actions recorded</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? (
                <div className="p-8 text-center text-xs text-[#80909D]">Loading route history...</div>
              ) : totalEvents === 0 ? (
                <div className="p-8 text-center text-xs text-[#80909D]">
                  No visits, bookings, or collections on this day.
                </div>
              ) : (
                <>
                  {/* Visits */}
                  {events.visits.map((v: any) => (
                    <div key={v.id} className="p-3 rounded-xl border border-[#CBD2D7] bg-[#F3F5F6] space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#0B1320] flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-[#2E6819]" />
                          {v.clientName}
                        </span>
                        <StatusBadge status={v.outcome} />
                      </div>
                      <p className="text-[#586570]">
                        {new Date(v.startedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} • GPS distance: {v.distanceFromClient != null ? `${Math.round(v.distanceFromClient)} m` : 'not recorded'}{v.isException ? ' • exception' : ''}
                      </p>
                    </div>
                  ))}

                  {/* Orders */}
                  {events.orders.map((o: any) => (
                    <div key={o.id} className="p-3 rounded-xl border border-[#CBD2D7] bg-white space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#0B1320] flex items-center gap-1.5">
                          <ShoppingCart className="w-3.5 h-3.5 text-[#081224]" />
                          {o.orderNumber}
                        </span>
                        <span className="font-bold text-[#0B1320]">₹{Number(o.grandTotal).toLocaleString('en-IN')}</span>
                      </div>
                      <p className="text-[#586570]">Client: {o.clientName} • {new Date(o.createdAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  ))}

                  {/* Collections */}
                  {events.payments.map((p: any) => (
                    <div key={p.id} className="p-3 rounded-xl border border-[#B4E39C] bg-[#E6F4DD]/40 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#2E6819] flex items-center gap-1.5">
                          <CreditCard className="w-3.5 h-3.5 text-[#2E6819]" />
                          {p.receiptNumber}
                        </span>
                        <span className="font-bold text-[#2E6819]">₹{Number(p.amount).toLocaleString('en-IN')}</span>
                      </div>
                      <p className="text-[#586570]">Mode: {String(p.paymentMethod).replace(/_/g, ' ')} • {new Date(p.collectedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  ))}

                  {/* Expenses */}
                  {events.expenses?.map((e: any) => (
                    <div key={e.id} className="p-3 rounded-xl border border-amber-200 bg-amber-50/60 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-900 flex items-center gap-1.5">
                          <Receipt className="w-3.5 h-3.5 text-amber-700" />
                          {e.expenseNumber}
                        </span>
                        <span className="font-bold text-amber-900">₹{Number(e.amount).toLocaleString('en-IN')}</span>
                      </div>
                      <p className="text-[#586570]">
                        {e.category.replace(/_/g, ' ')} {e.merchantName ? `(${e.merchantName})` : ''} • {new Date(e.expenseDate).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

export default function RouteHistoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-[#586570]">Loading route module...</div>}>
      <RouteHistoryContent />
    </Suspense>
  );
}
