'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import StatusBadge from '@/components/ui/StatusBadge';
import { ShieldAlert, Search, Filter, Clock, Laptop, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function AuditLogsPage() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    if (!token) return;
    try {
      let url = `/api/audit-logs?search=${encodeURIComponent(search)}`;
      if (moduleFilter) url += `&module=${moduleFilter}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setLogs(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [token, search, moduleFilter]);

  const toggleExpand = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  return (
    <AdminShell title="Security Audit Trail">
      <div className="space-y-6 max-w-7xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Compliance & Security
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              System Audit Logs & Traceability
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Immutable ledger of sensitive operations, record modifications, and user authentication events.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
              <input
                type="text"
                placeholder="Search action, user, module..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-4 py-1.5 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none w-72"
              />
            </div>

            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="px-3 py-1.5 bg-white border border-[#CBD2D7] rounded-lg text-xs font-semibold text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
            >
              <option value="">All Security Modules</option>
              <option value="AUTH">Authentication</option>
              <option value="ORDERS">Orders</option>
              <option value="PAYMENTS">Collections</option>
              <option value="CLIENTS">Clients & Assignments</option>
              <option value="ATTENDANCE">Attendance Shifts</option>
            </select>
          </div>
        </div>

        {/* Audit Logs Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                  <th className="py-3 px-4">Timestamp (IST)</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Module</th>
                  <th className="py-3 px-4">Record Identifier</th>
                  <th className="py-3 px-4">IP & Device</th>
                  <th className="py-3 px-4 text-center">Payload Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      Loading audit entries...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      No audit events matching criteria.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const isExpanded = expandedLogId === log.id;
                    return (
                      <React.Fragment key={log.id}>
                        <tr className="hover:bg-[#F3F5F6]/60 transition-colors">
                          <td className="py-3 px-4 font-mono text-[#586570]">
                            {new Date(log.createdAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-[#0B1320]">{log.userName}</p>
                            <p className="text-[10px] text-[#586570] uppercase">{log.userRole?.replace('_', ' ')}</p>
                          </td>
                          <td className="py-3 px-4 font-semibold text-[#0B1320] font-mono">
                            {log.action}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-[#0B1320] bg-[#F3F5F6] border border-[#CBD2D7] px-2 py-0.5 rounded text-[10px]">
                              {log.module}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#586570]">
                            {log.recordId ? log.recordId.slice(0, 13) + '...' : '-'}
                          </td>
                          <td className="py-3 px-4 text-[#586570] font-mono text-[11px]">
                            {log.ip || '127.0.0.1'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {(log.oldValue || log.newValue) ? (
                              <button
                                onClick={() => toggleExpand(log.id)}
                                className="px-2 py-1 rounded text-[11px] font-medium text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6]"
                              >
                                {isExpanded ? 'Hide' : 'Inspect'}
                              </button>
                            ) : (
                              <span className="text-[11px] text-[#80909D]">-</span>
                            )}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-[#F3F5F6]/50">
                            <td colSpan={7} className="p-4">
                              <div className="bg-white p-4 rounded-xl border border-[#CBD2D7] space-y-3 font-mono text-[11px]">
                                {log.oldValue && (
                                  <div>
                                    <span className="text-[#991B1B] font-bold">PREVIOUS STATE:</span>
                                    <pre className="bg-[#FDF2F2] p-2 rounded mt-1 overflow-x-auto text-[#991B1B]">
                                      {JSON.stringify(log.oldValue, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.newValue && (
                                  <div>
                                    <span className="text-[#2E6819] font-bold">UPDATED STATE:</span>
                                    <pre className="bg-[#E6F4DD] p-2 rounded mt-1 overflow-x-auto text-[#2E6819]">
                                      {JSON.stringify(log.newValue, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
