'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '@/components/layout/AdminShell';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { Users, Search, Plus, MapPin, Eye, Phone, Mail, Award, CheckCircle, Clock, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function SalespersonsPage() {
  const { token } = useAuth();
  const [salespersons, setSalespersons] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form state for creating salesperson
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [territory, setTerritory] = useState('');
  const [password, setPassword] = useState('Password123!');
  const [creating, setCreating] = useState(false);

  const fetchSalespersons = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/salespersons', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setSalespersons(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSalespersons();
  }, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/salespersons', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, employeeCode, territory, password }),
      });
      if (res.ok) {
        setShowAddModal(false);
        setName('');
        setEmail('');
        setPhone('');
        setEmployeeCode('');
        setTerritory('');
        fetchSalespersons();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create salesperson');
      }
    } catch (e: any) {
      alert(e.message || 'Error creating salesperson');
    } finally {
      setCreating(false);
    }
  };

  const filteredSalespersons = salespersons.filter((sp) => {
    const q = search.toLowerCase();
    return (
      sp.user?.name?.toLowerCase().includes(q) ||
      sp.employeeCode?.toLowerCase().includes(q) ||
      sp.territory?.toLowerCase().includes(q) ||
      sp.user?.phone?.includes(q)
    );
  });

  return (
    <AdminShell title="Sales Force Management">
      <div className="space-y-6 max-w-7xl">
        {/* Header Panel */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Field Personnel Directory
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              Sales Representatives & Duty Status
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Active sales force roster, assigned territories, tracking hardware status, and shift logs.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/salespersons/live">
              <Button variant="secondary" size="md" icon={<MapPin className="w-4 h-4 text-[#2E6819]" />}>
                Live Map
              </Button>
            </Link>
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowAddModal(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              Add Representative
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
            <input
              type="text"
              placeholder="Search by name, employee code, territory..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-4 py-1.5 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none w-80"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                  <th className="py-3 px-4">Salesperson</th>
                  <th className="py-3 px-4">Employee Code</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Territory</th>
                  <th className="py-3 px-4">Assigned Clients</th>
                  <th className="py-3 px-4">Duty Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      Loading sales representatives...
                    </td>
                  </tr>
                ) : filteredSalespersons.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      No sales representatives found.
                    </td>
                  </tr>
                ) : (
                  filteredSalespersons.map((sp) => (
                    <tr key={sp.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-[#E8EDEF] border border-[#CBD2D7] flex items-center justify-center font-bold text-[#0B1320] text-xs">
                            {sp.user?.name?.slice(0, 1)}
                          </div>
                          <div>
                            <p className="font-semibold text-[#0B1320]">{sp.user?.name}</p>
                            <p className="text-[11px] text-[#586570]">{sp.user?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-[#0B1320]">{sp.employeeCode}</td>
                      <td className="py-3 px-4 text-[#586570]">{sp.user?.phone}</td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-[#0B1320] bg-[#F3F5F6] border border-[#E2E7EC] px-2 py-0.5 rounded-md text-[11px]">
                          {sp.territory}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#586570]">
                        {sp.clientAssignments?.length || 0} Accounts
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={sp.status} />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <Link
                            href={`/salespersons/route?salespersonId=${sp.id}`}
                            className="px-2.5 py-1 rounded-md text-xs font-medium text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] transition-colors"
                          >
                            Route
                          </Link>
                          <Link
                            href={`/salespersons/performance?salespersonId=${sp.id}`}
                            className="px-2.5 py-1 rounded-md text-xs font-medium text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] transition-colors"
                          >
                            Stats
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-[#081224]/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#CBD2D7] rounded-xl max-w-md w-full p-6 shadow-xl animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E7EC]">
                <h3 className="text-base font-bold text-[#0B1320]">Register Sales Representative</h3>
                <button onClick={() => setShowAddModal(false)} className="text-[#586570] hover:text-[#0B1320]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="py-4 space-y-3.5 text-xs">
                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Anand Kumar"
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="anand@erp.com"
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Phone Number</label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="9876543210"
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Employee Code</label>
                    <input
                      type="text"
                      required
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value)}
                      placeholder="EMP-004"
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Territory Assignment</label>
                  <input
                    type="text"
                    required
                    value={territory}
                    onChange={(e) => setTerritory(e.target.value)}
                    placeholder="e.g. Mangalore Central"
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Initial Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-[#E2E7EC]">
                  <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit" disabled={creating}>
                    {creating ? 'Saving...' : 'Register Salesperson'}
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
