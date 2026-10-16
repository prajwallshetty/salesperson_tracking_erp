'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/layout/AdminShell';
import KpiCard from '@/components/ui/KpiCard';
import ActionTile from '@/components/ui/ActionTile';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  Users,
  Building2,
  ShoppingCart,
  IndianRupee,
  ShieldCheck,
  MapPin,
  TrendingUp,
  Package,
  Calendar,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export default function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/dashboard/summary', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [token]);

  const kpis = data?.kpis || {};
  const charts = data?.charts || {};

  return (
    <AdminShell title="Dashboard">
      <div className="space-y-6 max-w-7xl">
        {/* Top Operational Overview Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Operational Command Center
            </span>
            <h1 className="text-2xl font-bold text-[#0B1320] mt-0.5 tracking-tight">
              Field Sales & Attendance Overview
            </h1>
            <p className="text-xs md:text-sm text-[#586570] mt-1">
              Active tracking sessions, real-time client visits, order intake, and verified payment collections.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link href="/salespersons/live">
              <Button variant="secondary" size="md" icon={<MapPin className="w-4 h-4 text-[#2E6819]" />}>
                Live Tracking Map
              </Button>
            </Link>
            <Link href="/orders">
              <Button variant="primary" size="md">
                Create Order
              </Button>
            </Link>
          </div>
        </div>

        {/* Executive KPI Cards (White panels, 1px border, near-black values, soft lime icon backgrounds) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Active Sales Force"
            value={`${kpis.activeSalespersons ?? 0} / ${kpis.totalSalespersons ?? 0}`}
            subValue="Salespersons On Duty"
            icon={<Users className="w-4 h-4" />}
          />
          <KpiCard
            label="Today's Orders"
            value={kpis.todayOrdersCount ?? 0}
            subValue={`Gross: ₹${(kpis.todaySales ?? 0).toLocaleString('en-IN')}`}
            icon={<ShoppingCart className="w-4 h-4" />}
          />
          <KpiCard
            label="Today's Collections"
            value={`₹${(kpis.todayVerifiedCollections ?? 0).toLocaleString('en-IN')}`}
            subValue={`Pending: ₹${(kpis.todayPendingCollections ?? 0).toLocaleString('en-IN')}`}
            icon={<IndianRupee className="w-4 h-4" />}
          />
          <KpiCard
            label="Total Ledger Outstanding"
            value={`₹${(kpis.totalOutstanding ?? 0).toLocaleString('en-IN')}`}
            subValue={`${kpis.totalClients ?? 0} Registered Clients`}
            icon={<Building2 className="w-4 h-4" />}
          />
        </div>

        {/* Quick Action Tiles (Reference Style: White cards with lime icon tile and clean descriptions) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/salespersons/live">
            <ActionTile
              icon={<MapPin className="w-4 h-4" />}
              title="Live GPS Tracking"
              description="Monitor active sales representatives in real time on the interactive map."
            />
          </Link>
          <Link href="/payments?status=PENDING">
            <ActionTile
              icon={<ShieldCheck className="w-4 h-4" />}
              title="Verify Collections"
              description="Review pending cash, UPI, and bank transfer vouchers for ledger posting."
            />
          </Link>
          <Link href="/reports">
            <ActionTile
              icon={<TrendingUp className="w-4 h-4" />}
              title="Executive Reports"
              description="Export official sales, attendance, visits, and product turnover records."
            />
          </Link>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sales Trend Chart */}
          <div className="bg-white border border-[#CBD2D7] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[#0B1320]">Weekly Sales Velocity</h3>
                <p className="text-xs text-[#586570]">Daily order booking volume in INR</p>
              </div>
              <span className="text-xs font-medium text-[#586570] bg-[#F3F5F6] px-2.5 py-1 rounded-md border border-[#E2E7EC]">
                Last 7 Days
              </span>
            </div>

            <div className="h-64">
              {loading ? (
                <div className="h-full flex items-center justify-center text-xs text-[#80909D]">
                  Loading sales data...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.salesByDay || []} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E7EC" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={{ stroke: '#CBD2D7' }}
                      tick={{ fill: '#586570', fontSize: 11 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={{ stroke: '#CBD2D7' }}
                      tick={{ fill: '#586570', fontSize: 11 }}
                      tickFormatter={(v) => `₹${v >= 1000 ? `${v / 1000}k` : v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#CBD2D7',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#0B1320',
                      }}
                      formatter={(v: any) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Sales']}
                    />
                    <Bar dataKey="amount" fill="#081224" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Collections Trend Chart */}
          <div className="bg-white border border-[#CBD2D7] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[#0B1320]">Verified Collections</h3>
                <p className="text-xs text-[#586570]">Double-entry ledger credits in INR</p>
              </div>
              <span className="text-xs font-medium text-[#586570] bg-[#F3F5F6] px-2.5 py-1 rounded-md border border-[#E2E7EC]">
                Last 7 Days
              </span>
            </div>

            <div className="h-64">
              {loading ? (
                <div className="h-full flex items-center justify-center text-xs text-[#80909D]">
                  Loading collections...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.collectionsByDay || []} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E7EC" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={{ stroke: '#CBD2D7' }}
                      tick={{ fill: '#586570', fontSize: 11 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={{ stroke: '#CBD2D7' }}
                      tick={{ fill: '#586570', fontSize: 11 }}
                      tickFormatter={(v) => `₹${v >= 1000 ? `${v / 1000}k` : v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#CBD2D7',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#0B1320',
                      }}
                      formatter={(v: any) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Collected']}
                    />
                    <Bar dataKey="amount" fill="#B4E39C" stroke="#2E6819" strokeWidth={1} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Leaderboard and Top Products Grid (Reference Inset Rows styling) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Salesperson Performance */}
          <div className="bg-white border border-[#CBD2D7] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[#0B1320]">Field Sales Representatives</h3>
                <p className="text-xs text-[#586570]">Active team members and recorded turnover</p>
              </div>
              <Link href="/salespersons" className="text-xs font-medium text-[#259DC3] hover:underline">
                View all
              </Link>
            </div>

            <div className="space-y-2">
              {(charts.salespersonPerformance || []).map((sp: any) => (
                <div
                  key={sp.id}
                  className="bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl p-3 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-white border border-[#CBD2D7] flex items-center justify-center font-semibold text-[#0B1320]">
                      {sp.name.slice(0, 1)}
                    </div>
                    <div>
                      <p className="font-semibold text-[#0B1320]">{sp.name}</p>
                      <p className="text-[11px] text-[#586570]">{sp.territory}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="font-semibold text-[#0B1320]">₹{sp.sales.toLocaleString('en-IN')}</p>
                      <p className="text-[10px] text-[#586570]">{sp.ordersCount} orders</p>
                    </div>
                    <StatusBadge status={sp.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Selling Products */}
          <div className="bg-white border border-[#CBD2D7] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[#0B1320]">Top Catalog Items</h3>
                <p className="text-xs text-[#586570]">Highest revenue generating stock units</p>
              </div>
              <Link href="/products" className="text-xs font-medium text-[#259DC3] hover:underline">
                View catalog
              </Link>
            </div>

            <div className="space-y-2">
              {(charts.topProducts || []).map((p: any, idx: number) => (
                <div
                  key={p.name}
                  className="bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl p-3 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-md bg-[#E6F4DD] text-[#2E6819] flex items-center justify-center font-semibold text-[11px]">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="font-semibold text-[#0B1320]">{p.name}</p>
                      <p className="text-[11px] text-[#586570]">{p.quantity} units sold</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-bold text-[#0B1320]">
                      ₹{Math.round(p.total).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
