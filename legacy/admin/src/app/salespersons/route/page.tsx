'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminShell from '@/components/layout/AdminShell';
import RouteMap from '@/components/maps/RouteMap';
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
import { useAuth } from '@/context/AuthContext';

function RouteHistoryContent() {
  const searchParams = useSearchParams();
  const initialSpId = searchParams.get('salespersonId') || '';
  const { token } = useAuth();

  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [selectedSpId, setSelectedSpId] = useState(initialSpId);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [routeData, setRouteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Load salespersons list
  useEffect(() => {
    if (!token) return;
    fetch('/api/salespersons', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => {
        const list = json.data || [];
        setSalespersons(list);
        if (!selectedSpId && list.length > 0) {
          setSelectedSpId(list[0].id);
        }
      });
  }, [token]);

  // Load route history for selected salesperson & date
  useEffect(() => {
    if (!token || !selectedSpId) return;
    setLoading(true);
    fetch(`/api/location/history?salespersonId=${selectedSpId}&date=${selectedDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        setRouteData(json);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, selectedSpId, selectedDate]);

  const points = routeData?.points || [];
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
              Est. Distance: {routeData?.estimatedDistanceKm ? `${routeData.estimatedDistanceKm.toFixed(1)} KM` : '0 KM'}
            </span>
            <span className="text-xs font-semibold text-[#2E6819] bg-[#E6F4DD] border border-[#B4E39C] px-3 py-1.5 rounded-lg">
              {points.length} GPS Points Recorded
            </span>
          </div>
        </div>

        {/* Map & Timeline Grid */}
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-230px)]">
          {/* Map Canvas */}
          <div className="flex-1 bg-white rounded-xl border border-[#CBD2D7] overflow-hidden flex flex-col">
            <div className="p-3.5 border-b border-[#CBD2D7] bg-[#F3F5F6]/60 flex items-center justify-between text-xs">
              <span className="font-semibold text-[#0B1320]">GPS Breadcrumb Route Polyline</span>
              <span className="text-[11px] text-[#586570]">
                {points.length > 0
                  ? `Shift start: ${new Date(points[0].timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                  : 'No GPS movement logged for this date'}
              </span>
            </div>
            <div className="flex-1 relative">
              <RouteMap points={points} events={events} />
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
                        {new Date(v.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} • GPS Distance: {v.distanceFromClient ? `${Math.round(v.distanceFromClient)}m` : '0m'}
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
                      <p className="text-[#586570]">Client: {o.clientName} • {new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
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
                      <p className="text-[#586570]">Mode: {p.method} • {new Date(p.collectedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
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
                        {e.category.replace(/_/g, ' ')} {e.merchantName ? `(${e.merchantName})` : ''} • {new Date(e.expenseDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
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
