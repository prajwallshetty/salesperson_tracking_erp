'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import Button from '@/components/ui/Button';
import { Users, Building2, UserCheck, ArrowRight, ShieldCheck, Clock, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ClientAssignmentsPage() {
  const { token } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [primarySpId, setPrimarySpId] = useState('');
  const [backupSpId, setBackupSpId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    if (!token) return;
    try {
      const [cRes, sRes] = await Promise.all([
        fetch('/api/clients', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
        fetch('/api/salespersons', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      ]);
      setClients(cRes.data || []);
      setSalespersons(sRes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const openAssignModal = (client: any) => {
    setSelectedClient(client);
    setPrimarySpId(client.primarySalesperson?.id || '');
    setBackupSpId(client.backupSalesperson?.id || '');
    setNotes('');
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !primarySpId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/assign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primarySalespersonId: primarySpId,
          backupSalespersonId: backupSpId || undefined,
          notes,
        }),
      });

      if (res.ok) {
        setSelectedClient(null);
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to reassign client');
      }
    } catch (e: any) {
      alert(e.message || 'Error updating assignment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminShell title="Territory & Client Assignments">
      <div className="space-y-6 max-w-7xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Account Ownership
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              Client Allocation & Coverage
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Maintain primary and secondary sales representatives with permanent auditable change logs.
            </p>
          </div>
        </div>

        {/* Assignments Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">City / State</th>
                  <th className="py-3 px-4">Primary Representative</th>
                  <th className="py-3 px-4">Backup Representative</th>
                  <th className="py-3 px-4">Assigned On</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#80909D]">
                      Loading client assignments...
                    </td>
                  </tr>
                ) : (
                  clients.map((c) => (
                    <tr key={c.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#0B1320]">{c.name}</td>
                      <td className="py-3 px-4 text-[#586570]">{c.city}, {c.state}</td>
                      <td className="py-3 px-4">
                        {c.primarySalesperson ? (
                          <span className="font-semibold text-[#0B1320] bg-[#F3F5F6] border border-[#CBD2D7] px-2.5 py-1 rounded-md text-[11px]">
                            {c.primarySalesperson.name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#586570] bg-[#F3F5F6] border border-[#CBD2D7] px-2.5 py-1 rounded-md">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {c.backupSalesperson ? (
                          <span className="font-semibold text-[#586570] bg-[#F3F5F6] border border-[#E2E7EC] px-2.5 py-1 rounded-md text-[11px]">
                            {c.backupSalesperson.name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#80909D]">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[#586570]">
                        {c.assignedAt ? new Date(c.assignedAt).toLocaleDateString('en-IN') : 'Default Seed'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openAssignModal(c)}
                        >
                          Reassign
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal */}
        {selectedClient && (
          <div className="fixed inset-0 bg-[#081224]/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#CBD2D7] rounded-xl max-w-md w-full p-6 shadow-xl animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E7EC]">
                <h3 className="text-base font-bold text-[#0B1320]">
                  Reassign {selectedClient.name}
                </h3>
                <button onClick={() => setSelectedClient(null)} className="text-[#586570] hover:text-[#0B1320]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAssign} className="py-4 space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Primary Salesperson</label>
                  <select
                    required
                    value={primarySpId}
                    onChange={(e) => setPrimarySpId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-xs font-medium text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
                  >
                    <option value="">Select Primary Salesperson</option>
                    {salespersons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.territory})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Backup Salesperson (Optional)</label>
                  <select
                    value={backupSpId}
                    onChange={(e) => setBackupSpId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-xs font-medium text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
                  >
                    <option value="">None / Optional</option>
                    {salespersons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.territory})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Reason for Reassignment</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Territory boundary restructuring."
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:ring-1 focus:ring-[#081224] focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-[#E2E7EC]">
                  <Button variant="secondary" onClick={() => setSelectedClient(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" disabled={submitting}>
                    {submitting ? 'Updating...' : 'Save Assignment'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
