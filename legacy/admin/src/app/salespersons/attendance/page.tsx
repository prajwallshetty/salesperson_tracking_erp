'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/layout/AdminShell';
import StatusBadge from '@/components/ui/StatusBadge';
import { Calendar, User, Clock, Navigation, MapPin } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function AttendancePage() {
  const { token } = useAuth();
  const [attendances, setAttendances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [salespersonId, setSalespersonId] = useState('');
  const [salespersons, setSalespersons] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch('/api/salespersons', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => setSalespersons(json.data || []));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    let url = '/api/attendance/history';
    if (salespersonId) url += `?salespersonId=${salespersonId}`;

    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => setAttendances(json.data || []))
      .finally(() => setLoading(false));
  }, [token, salespersonId]);

  return (
    <AdminShell title="Attendance & Shift Logs">
      <div className="space-y-6 max-w-7xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Shift Compliance
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              Work Sessions & Daily Travel Logs
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Start/End day timestamps, verified login coordinates, shift durations, and estimated route mileage.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={salespersonId}
              onChange={(e) => setSalespersonId(e.target.value)}
              className="px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
            >
              <option value="">All Sales Representatives</option>
              {salespersons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.employeeCode})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                  <th className="py-3 px-4">Salesperson</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Check-In Time</th>
                  <th className="py-3 px-4">Check-Out Time</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Distance Travelled</th>
                  <th className="py-3 px-4">Duty Status</th>
                  <th className="py-3 px-4 text-center">Route Replay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[#80909D]">
                      Loading attendance records...
                    </td>
                  </tr>
                ) : attendances.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[#80909D]">
                      No attendance sessions found.
                    </td>
                  </tr>
                ) : (
                  attendances.map((a) => (
                    <tr key={a.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0B1320]">{a.salespersonName}</p>
                        <p className="text-[11px] text-[#586570] font-mono">{a.salespersonCode}</p>
                      </td>
                      <td className="py-3 px-4 text-[#586570]">
                        {new Date(a.date).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-[#0B1320]">
                          {a.loginAt ? new Date(a.loginAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'}
                        </span>
                        {a.loginLatitude && (
                          <p className="text-[10px] font-mono text-[#80909D]">
                            GPS: {a.loginLatitude.toFixed(3)}, {a.loginLongitude.toFixed(3)}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-[#0B1320]">
                          {a.logoutAt ? new Date(a.logoutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Active Shift'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#586570] font-medium">
                        {a.workingMinutes ? `${Math.floor(a.workingMinutes / 60)}h ${a.workingMinutes % 60}m` : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-[#0B1320]">
                        {a.distanceTravelled ? `${a.distanceTravelled.toFixed(1)} km` : '-'}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Link
                          href={`/salespersons/route?salespersonId=${a.salespersonId}&date=${new Date(a.date).toISOString().split('T')[0]}`}
                          className="px-2.5 py-1 rounded-md text-xs font-medium text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] transition-colors"
                        >
                          View Map
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
