'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminShell from '@/components/layout/AdminShell';
import KpiCard from '@/components/ui/KpiCard';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  Award,
  Calendar,
  IndianRupee,
  ShoppingCart,
  Users,
  Navigation,
  Clock,
  Filter,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

function PerformanceContent() {
  const searchParams = useSearchParams();
  const initialSpId = searchParams.get('salespersonId') || '';
  const { token } = useAuth();

  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [selectedSpId, setSelectedSpId] = useState(initialSpId);
  const [range, setRange] = useState('this_month');
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!token || !selectedSpId) return;
    setLoading(true);
    fetch(`/api/salespersons/${selectedSpId}/performance?range=${range}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => setMetrics(json))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, selectedSpId, range]);

  const selectedSp = salespersons.find((s) => s.id === selectedSpId);

  return (
    <AdminShell title="Salesperson Performance">
      <div className="space-y-6 max-w-7xl">
        {/* Filters Panel */}
        <div className="bg-white p-5 rounded-xl border border-[#CBD2D7] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold text-[#586570]">Select Representative:</label>
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

          <div className="flex items-center gap-1.5">
            {[
              { id: 'today', label: 'Today' },
              { id: 'this_week', label: 'This Week' },
              { id: 'this_month', label: 'This Month' },
              { id: 'all_time', label: 'All Time' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setRange(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  range === t.id
                    ? 'bg-[#081224] text-white border-[#081224]'
                    : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Representative Summary Card */}
        {selectedSp && (
          <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#E8EDEF] border border-[#CBD2D7] flex items-center justify-center font-bold text-[#0B1320] text-base">
                {selectedSp.name.slice(0, 1)}
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0B1320]">{selectedSp.name}</h2>
                <p className="text-xs text-[#586570]">
                  {selectedSp.employeeCode} • Territory: <strong className="text-[#0B1320]">{selectedSp.territory}</strong>
                </p>
              </div>
            </div>
            <StatusBadge status={selectedSp.dutyStatus} />
          </div>
        )}

        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KpiCard
            label="Total Sales Booked"
            value={`₹${(metrics?.sales || 0).toLocaleString('en-IN')}`}
            subValue={`${metrics?.orders || 0} purchase orders`}
            icon={<IndianRupee className="w-4 h-4" />}
          />
          <KpiCard
            label="Verified Collections"
            value={`₹${(metrics?.collections || 0).toLocaleString('en-IN')}`}
            subValue="Post-reconciliation ledger credits"
            icon={<Award className="w-4 h-4" />}
          />
          <KpiCard
            label="Client Visits Completed"
            value={metrics?.clientsVisited || 0}
            subValue={`${metrics?.newClients || 0} new clients added`}
            icon={<Users className="w-4 h-4" />}
          />
          <KpiCard
            label="Estimated Travel Distance"
            value={`${(metrics?.distance || 0).toFixed(1)} KM`}
            subValue="GPS breadcrumb estimation"
            icon={<Navigation className="w-4 h-4" />}
          />
          <KpiCard
            label="Active Duty Shifts"
            value={`${metrics?.workingDays || 0} Days`}
            subValue="Attendance sessions logged"
            icon={<Clock className="w-4 h-4" />}
          />
          <KpiCard
            label="Average Booking Value"
            value={
              metrics?.orders > 0
                ? `₹${Math.round(metrics.sales / metrics.orders).toLocaleString('en-IN')}`
                : '₹0'
            }
            subValue="Per booked purchase order"
            icon={<ShoppingCart className="w-4 h-4" />}
          />
        </div>
      </div>
    </AdminShell>
  );
}

export default function PerformancePage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-[#586570]">Loading performance module...</div>}>
      <PerformanceContent />
    </Suspense>
  );
}
