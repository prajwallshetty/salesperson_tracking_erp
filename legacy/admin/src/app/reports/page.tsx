'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminShell from '@/components/layout/AdminShell';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  FileBarChart,
  Download,
  Calendar,
  Filter,
  IndianRupee,
  TrendingUp,
  Package,
  Users,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

function ReportsContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'sales';
  const { token } = useAuth();

  const [activeTab, setActiveTab] = useState(initialTab);
  const [reportData, setReportData] = useState<any>(null);
  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [selectedSpId, setSelectedSpId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch('/api/salespersons', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => setSalespersons(json.data || []));
  }, [token]);

  const fetchReport = async () => {
    if (!token) return;
    setLoading(true);
    try {
      let endpoint = `/api/reports/${activeTab}`;
      const params = new URLSearchParams();
      if (selectedSpId) params.append('salespersonId', selectedSpId);
      if (from) params.append('from', from);
      if (to) params.append('to', to);

      const url = `${endpoint}?${params.toString()}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setReportData(json);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [token, activeTab, selectedSpId, from, to]);

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (selectedSpId) params.append('salespersonId', selectedSpId);
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    params.append('format', 'csv');

    window.open(`/api/reports/${activeTab}?${params.toString()}`, '_blank');
  };

  const rows = reportData?.data || [];
  const summary = reportData?.summary || {};

  return (
    <AdminShell title="Business Intelligence Reports">
      <div className="space-y-6 max-w-7xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Operational Intelligence
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              Exports & Financial Auditing
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Authoritative transaction logs, client visits, attendance records, and product sales statistics.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="md"
              onClick={handleExportCsv}
              icon={<Download className="w-4 h-4 text-[#0B1320]" />}
            >
              Export CSV / Excel
            </Button>
          </div>
        </div>

        {/* Tab Navigation (Reference Pill Styling) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { id: 'sales', label: 'Sales Orders' },
            { id: 'collections', label: 'Collections & Verification' },
            { id: 'attendance', label: 'Attendance & Mileage' },
            { id: 'visits', label: 'Client Visits' },
            { id: 'products', label: 'Product Turnover' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[#081224] text-white border-[#081224]'
                  : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-4 rounded-xl border border-[#CBD2D7] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedSpId}
              onChange={(e) => setSelectedSpId(e.target.value)}
              className="px-3 py-1.5 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
            >
              <option value="">All Sales Representatives</option>
              {salespersons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.employeeCode})
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2 text-xs text-[#586570]">
              <span>From:</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="px-2.5 py-1 bg-white border border-[#CBD2D7] rounded-lg text-xs text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
              />
              <span>To:</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="px-2.5 py-1 bg-white border border-[#CBD2D7] rounded-lg text-xs text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Summary KPI preview if available */}
        {summary.totalSales !== undefined && (
          <div className="p-4 bg-[#E6F4DD] border border-[#B4E39C] rounded-xl flex items-center justify-between text-xs text-[#2E6819]">
            <div>
              <span className="font-semibold">Total Filtered Sales: </span>
              <span className="text-base font-bold ml-1">₹{summary.totalSales.toLocaleString('en-IN')}</span>
            </div>
            <div>
              <span className="font-semibold">Orders Booked: </span>
              <span className="text-base font-bold ml-1">{summary.totalOrders}</span>
            </div>
          </div>
        )}

        {/* Dynamic Report Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            {activeTab === 'sales' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                    <th className="py-3 px-4">Order #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Salesperson</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">City</th>
                    <th className="py-3 px-4 text-right">Subtotal</th>
                    <th className="py-3 px-4 text-right">Discount</th>
                    <th className="py-3 px-4 text-right">GST Tax</th>
                    <th className="py-3 px-4 text-right">Grand Total</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7EC]">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-[#0B1320]">{r.orderNumber}</td>
                      <td className="py-3 px-4 text-[#586570]">{new Date(r.date).toLocaleDateString('en-IN')}</td>
                      <td className="py-3 px-4 font-semibold text-[#0B1320]">{r.salespersonName}</td>
                      <td className="py-3 px-4 text-[#0B1320]">{r.clientName}</td>
                      <td className="py-3 px-4 text-[#586570]">{r.clientCity}</td>
                      <td className="py-3 px-4 text-right text-[#586570]">₹{r.subtotal.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-right text-[#586570]">₹{r.discount.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-right text-[#586570]">₹{r.tax.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-right font-bold text-[#0B1320]">₹{r.grandTotal.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'collections' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                    <th className="py-3 px-4">Receipt #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Salesperson</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">Mode</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Verified By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7EC]">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-[#0B1320]">{r.receiptNumber}</td>
                      <td className="py-3 px-4 text-[#586570]">{new Date(r.date).toLocaleDateString('en-IN')}</td>
                      <td className="py-3 px-4 font-semibold text-[#0B1320]">{r.salespersonName}</td>
                      <td className="py-3 px-4 text-[#0B1320]">{r.clientName}</td>
                      <td className="py-3 px-4 font-medium text-[#586570]">{r.paymentMethod}</td>
                      <td className="py-3 px-4 text-right font-bold text-[#0B1320]">₹{r.amount.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-3 px-4 text-[#586570]">{r.verifiedBy || 'Pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'attendance' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                    <th className="py-3 px-4">Salesperson</th>
                    <th className="py-3 px-4">Territory</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Work Time</th>
                    <th className="py-3 px-4">Distance</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7EC]">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#0B1320]">{r.salespersonName}</td>
                      <td className="py-3 px-4 text-[#586570]">{r.territory}</td>
                      <td className="py-3 px-4 text-[#586570]">{r.date.split('T')[0]}</td>
                      <td className="py-3 px-4 font-medium text-[#0B1320]">{r.workingMinutes} mins</td>
                      <td className="py-3 px-4 font-bold text-[#0B1320] font-mono">{r.distanceKm} KM</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'visits' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                    <th className="py-3 px-4">Salesperson</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">City</th>
                    <th className="py-3 px-4">Visit Time</th>
                    <th className="py-3 px-4">GPS Distance</th>
                    <th className="py-3 px-4">Outcome</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7EC]">
                  {rows.map((r: any) => (
                    <tr key={r.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#0B1320]">{r.salespersonName}</td>
                      <td className="py-3 px-4 text-[#0B1320]">{r.clientName}</td>
                      <td className="py-3 px-4 text-[#586570]">{r.clientCity}</td>
                      <td className="py-3 px-4 text-[#586570]">{new Date(r.startedAt).toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 font-mono">{r.distanceFromClient || 0}m</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={r.outcome} />
                      </td>
                      <td className="py-3 px-4 text-[#586570] max-w-xs truncate">{r.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'products' && (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                    <th className="py-3 px-4">SKU</th>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Quantity Sold</th>
                    <th className="py-3 px-4 text-right">Total Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7EC]">
                  {rows.map((r: any) => (
                    <tr key={r.sku} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-[#0B1320]">{r.sku}</td>
                      <td className="py-3 px-4 font-semibold text-[#0B1320]">{r.name}</td>
                      <td className="py-3 px-4 text-[#586570]">{r.category}</td>
                      <td className="py-3 px-4 text-right font-bold text-[#0B1320]">{r.quantity}</td>
                      <td className="py-3 px-4 text-right font-bold text-[#0B1320]">₹{r.revenue.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-[#586570]">Loading reports...</div>}>
      <ReportsContent />
    </Suspense>
  );
}
