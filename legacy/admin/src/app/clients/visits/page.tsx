'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import StatusBadge from '@/components/ui/StatusBadge';
import { CalendarCheck, MapPin, AlertTriangle, CheckCircle, Search, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ClientVisitsPage() {
  const { token } = useAuth();
  const [visits, setVisits] = useState<any[]>([]);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchVisits = async () => {
    if (!token) return;
    try {
      let url = '/api/visits';
      if (outcomeFilter) url += `?outcome=${outcomeFilter}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setVisits(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVisits();
  }, [token, outcomeFilter]);

  return (
    <AdminShell title="Client Field Visits">
      <div className="space-y-6 max-w-7xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Field Verification
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              Client Visits & GPS Evidence
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Geofence distance calculations, visit timestamps, operational outcomes, and radius exception justifications.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
            >
              <option value="">All Visit Outcomes</option>
              <option value="ORDER_TAKEN">Order Taken</option>
              <option value="PAYMENT_COLLECTED">Payment Collected</option>
              <option value="FOLLOW_UP_REQUIRED">Follow-up Required</option>
              <option value="NO_ORDER">No Order</option>
              <option value="CLIENT_CLOSED">Client Closed</option>
            </select>
          </div>
        </div>

        {/* Visits Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Salesperson</th>
                  <th className="py-3 px-4">Visit Time</th>
                  <th className="py-3 px-4">GPS Distance & Verification</th>
                  <th className="py-3 px-4">Outcome</th>
                  <th className="py-3 px-4">Field Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#80909D]">
                      Loading visit records...
                    </td>
                  </tr>
                ) : visits.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#80909D]">
                      No visit records found.
                    </td>
                  </tr>
                ) : (
                  visits.map((v) => {
                    const isBreach = v.distanceFromClient !== null && v.distanceFromClient > 100;
                    return (
                      <tr key={v.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                        <td className="py-3 px-4 font-semibold text-[#0B1320]">{v.clientName}</td>
                        <td className="py-3 px-4 text-[#586570]">
                          <span className="font-medium text-[#0B1320]">{v.salespersonName}</span>{' '}
                          <span className="text-[10px] text-[#80909D]">({v.salespersonCode})</span>
                        </td>
                        <td className="py-3 px-4 text-[#586570]">
                          {new Date(v.startedAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                          })}{' '}
                          • {new Date(v.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-[#0B1320]">
                              {v.distanceFromClient !== null ? `${Math.round(v.distanceFromClient)}m` : 'N/A'}
                            </span>
                            {isBreach ? (
                              <span className="text-[10px] font-semibold bg-[#FDF2F2] text-[#991B1B] border border-[#F8C4C4] px-1.5 py-0.5 rounded">
                                Radius Breach (&gt;100m)
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold bg-[#E6F4DD] text-[#2E6819] border border-[#B4E39C] px-1.5 py-0.5 rounded">
                                In Range
                              </span>
                            )}
                          </div>
                          {v.latitude && (
                            <p className="text-[10px] font-mono text-[#80909D] mt-0.5">
                              GPS: {v.latitude.toFixed(4)}, {v.longitude?.toFixed(4)}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={v.outcome} />
                        </td>
                        <td className="py-3 px-4 text-[#586570] max-w-xs truncate">
                          {v.notes || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
