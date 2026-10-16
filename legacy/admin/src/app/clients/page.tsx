'use client';

import React, { useEffect, useState } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  Building2,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  Eye,
  IndianRupee,
  FileText,
  Clock,
  ShieldCheck,
  ChevronRight,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function ClientsPage() {
  const { token } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  // Detail Modal
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientDetail, setClientDetail] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'ledger' | 'orders' | 'payments' | 'visits'>('overview');

  // Add Client Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    businessName: '',
    contactPerson: '',
    phone: '',
    email: '',
    gstNumber: '',
    address: '',
    city: 'Mangalore',
    state: 'Karnataka',
    pincode: '575001',
    latitude: 12.8715,
    longitude: 74.8432,
    creditLimit: 100000,
    paymentTerms: 'Net 30',
    openingBalance: 0,
  });

  const fetchClients = async () => {
    if (!token) return;
    try {
      let url = `/api/clients?search=${encodeURIComponent(search)}`;
      if (pendingOnly) url += '&pendingOnly=true';

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setClients(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [token, search, pendingOnly]);

  const openClientDetail = async (id: string) => {
    setSelectedClientId(id);
    setDetailTab('overview');
    try {
      const res = await fetch(`/api/clients/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setClientDetail(json.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setShowAddModal(false);
        fetchClients();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create client');
      }
    } catch (e: any) {
      alert(e.message || 'Error creating client');
    }
  };

  return (
    <AdminShell title="Client Relationship Management">
      <div className="space-y-6 max-w-7xl">
        {/* Header & Filter Bar */}
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
              Account Directory
            </span>
            <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
              Client Accounts & Ledgers
            </h1>
            <p className="text-xs text-[#586570] mt-1">
              Registered retail outlets, corporate accounts, credit limits, and double-entry balance statements.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowAddModal(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              New Client
            </Button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
              <input
                type="text"
                placeholder="Search clients, phone, city..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-4 py-1.5 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none w-72"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-[#586570] bg-white px-3 py-1.5 border border-[#CBD2D7] rounded-lg cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={(e) => setPendingOnly(e.target.checked)}
                className="rounded text-[#081224] focus:ring-[#081224]"
              />
              <span>With Outstanding Balance Only</span>
            </label>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Assigned Representative</th>
                  <th className="py-3 px-4">Credit Limit</th>
                  <th className="py-3 px-4 text-right">Current Outstanding</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      Loading clients...
                    </td>
                  </tr>
                ) : clients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#80909D]">
                      No client accounts found.
                    </td>
                  </tr>
                ) : (
                  clients.map((c) => (
                    <tr key={c.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0B1320]">{c.name}</p>
                        <p className="text-[11px] text-[#586570]">{c.businessName || c.category}</p>
                      </td>
                      <td className="py-3 px-4 text-[#586570]">
                        <p className="font-medium text-[#0B1320]">{c.contactPerson}</p>
                        <p className="text-[11px] text-[#586570]">{c.phone}</p>
                      </td>
                      <td className="py-3 px-4 text-[#586570]">
                        <p>{c.city}, {c.state}</p>
                        <p className="text-[10px] text-[#80909D] font-mono">
                          {c.latitude?.toFixed(4)}, {c.longitude?.toFixed(4)}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        {c.primarySalesperson ? (
                          <span className="font-medium text-[#0B1320] bg-[#F3F5F6] border border-[#E2E7EC] px-2 py-0.5 rounded-md text-[11px]">
                            {c.primarySalesperson.name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#586570] bg-[#F3F5F6] border border-[#CBD2D7] px-2 py-0.5 rounded-md">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[#586570] font-medium">
                        ₹{(c.creditLimit || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[#0B1320]">
                        <span className={c.currentOutstanding > 0 ? 'text-[#0B1320]' : 'text-[#2E6819]'}>
                          ₹{(c.currentOutstanding || 0).toLocaleString('en-IN')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => openClientDetail(c.id)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium text-[#0B1320] border border-[#CBD2D7] hover:bg-[#F3F5F6] transition-colors"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Client Detail Drawer / Modal */}
        {selectedClientId && (
          <div className="fixed inset-0 bg-[#081224]/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#CBD2D7] rounded-xl max-w-3xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto animate-in fade-in">
              <div className="flex items-center justify-between pb-4 border-b border-[#E2E7EC]">
                <div>
                  <h3 className="text-lg font-bold text-[#0B1320]">
                    {clientDetail?.name || 'Client Details'}
                  </h3>
                  <p className="text-xs text-[#586570]">
                    {clientDetail?.businessName} • GST: {clientDetail?.gstNumber || 'Unregistered'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedClientId(null)}
                  className="p-1 rounded-lg text-[#586570] hover:bg-[#F3F5F6]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {clientDetail ? (
                <div className="py-4 space-y-4 text-xs">
                  {/* Top Stats Banner */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl">
                      <p className="text-[#586570]">Current Outstanding</p>
                      <p className="text-base font-bold text-[#0B1320] mt-1">
                        ₹{(clientDetail.currentOutstanding || 0).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="p-3 bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl">
                      <p className="text-[#586570]">Credit Limit</p>
                      <p className="text-base font-bold text-[#0B1320] mt-1">
                        ₹{(clientDetail.creditLimit || 0).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <div className="p-3 bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl">
                      <p className="text-[#586570]">Payment Terms</p>
                      <p className="text-base font-bold text-[#0B1320] mt-1">
                        {clientDetail.paymentTerms || 'Net 30'}
                      </p>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-2 border-b border-[#E2E7EC] pb-2">
                    {[
                      { id: 'overview', label: 'Overview' },
                      { id: 'ledger', label: 'Authoritative Ledger' },
                      { id: 'orders', label: 'Orders' },
                      { id: 'payments', label: 'Collections' },
                      { id: 'visits', label: 'Visits' },
                    ].map((tab: any) => (
                      <button
                        key={tab.id}
                        onClick={() => setDetailTab(tab.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          detailTab === tab.id
                            ? 'bg-[#081224] text-white'
                            : 'text-[#586570] hover:text-[#0B1320] hover:bg-[#F3F5F6]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab 1: Overview */}
                  {detailTab === 'overview' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[#586570]">Primary Contact</p>
                          <p className="font-semibold text-[#0B1320] mt-0.5">{clientDetail.contactPerson}</p>
                          <p className="text-[#586570]">{clientDetail.phone}</p>
                          <p className="text-[#586570]">{clientDetail.email || 'No email registered'}</p>
                        </div>
                        <div>
                          <p className="text-[#586570]">Billing & Shipping Address</p>
                          <p className="font-semibold text-[#0B1320] mt-0.5">{clientDetail.address}</p>
                          <p className="text-[#586570]">{clientDetail.city}, {clientDetail.state} - {clientDetail.pincode}</p>
                          <p className="font-mono text-[#80909D] text-[10px] mt-1">
                            GPS: {clientDetail.latitude}, {clientDetail.longitude}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tab 2: Ledger */}
                  {detailTab === 'ledger' && (
                    <div className="border border-[#CBD2D7] rounded-xl overflow-hidden">
                      <table className="w-full text-left">
                        <thead className="bg-[#F3F5F6] text-[#586570] font-semibold border-b border-[#CBD2D7]">
                          <tr>
                            <th className="p-2.5">Date</th>
                            <th className="p-2.5">Type</th>
                            <th className="p-2.5">Description</th>
                            <th className="p-2.5 text-right">Debit</th>
                            <th className="p-2.5 text-right">Credit</th>
                            <th className="p-2.5 text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E7EC]">
                          {clientDetail.ledgerEntries?.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-4 text-center text-[#80909D]">
                                No ledger transactions posted yet.
                              </td>
                            </tr>
                          ) : (
                            clientDetail.ledgerEntries?.map((l: any) => (
                              <tr key={l.id} className="hover:bg-[#F3F5F6]/40">
                                <td className="p-2.5 text-[#586570]">
                                  {new Date(l.date).toLocaleDateString('en-IN')}
                                </td>
                                <td className="p-2.5 font-semibold text-[#0B1320]">{l.entryType}</td>
                                <td className="p-2.5 text-[#586570]">{l.description}</td>
                                <td className="p-2.5 text-right font-medium text-[#0B1320]">
                                  {l.debit > 0 ? `₹${Number(l.debit).toLocaleString('en-IN')}` : '-'}
                                </td>
                                <td className="p-2.5 text-right font-medium text-[#2E6819]">
                                  {l.credit > 0 ? `₹${Number(l.credit).toLocaleString('en-IN')}` : '-'}
                                </td>
                                <td className="p-2.5 text-right font-bold text-[#0B1320]">
                                  ₹{Number(l.runningBalance).toLocaleString('en-IN')}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Tab 3: Orders */}
                  {detailTab === 'orders' && (
                    <div className="space-y-2">
                      {clientDetail.orders?.map((o: any) => (
                        <div key={o.id} className="p-3 bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl flex justify-between items-center">
                          <div>
                            <p className="font-bold text-[#0B1320]">{o.orderNumber}</p>
                            <p className="text-[#586570]">{new Date(o.createdAt).toLocaleDateString('en-IN')}</p>
                          </div>
                          <div className="text-right flex items-center gap-3">
                            <span className="font-bold text-[#0B1320]">₹{Number(o.grandTotal).toLocaleString('en-IN')}</span>
                            <StatusBadge status={o.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tab 4: Payments */}
                  {detailTab === 'payments' && (
                    <div className="space-y-2">
                      {clientDetail.payments?.map((p: any) => (
                        <div key={p.id} className="p-3 bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl flex justify-between items-center">
                          <div>
                            <p className="font-bold text-[#0B1320]">{p.receiptNumber}</p>
                            <p className="text-[#586570]">{p.paymentMethod} • {new Date(p.collectedAt).toLocaleDateString('en-IN')}</p>
                          </div>
                          <div className="text-right flex items-center gap-3">
                            <span className="font-bold text-[#2E6819]">₹{Number(p.amount).toLocaleString('en-IN')}</span>
                            <StatusBadge status={p.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tab 5: Visits */}
                  {detailTab === 'visits' && (
                    <div className="space-y-2">
                      {clientDetail.visits?.map((v: any) => (
                        <div key={v.id} className="p-3 bg-[#F3F5F6] border border-[#E2E7EC] rounded-xl flex justify-between items-center">
                          <div>
                            <p className="font-bold text-[#0B1320]">{v.outcome.replace('_', ' ')}</p>
                            <p className="text-[#586570]">
                              {new Date(v.startedAt).toLocaleDateString('en-IN')} • Distance: {v.distanceFromClient ? `${Math.round(v.distanceFromClient)}m` : 'N/A'}
                            </p>
                          </div>
                          <StatusBadge status={v.outcome} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-[#80909D]">Loading client details...</div>
              )}
            </div>
          </div>
        )}

        {/* Add Client Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-[#081224]/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#CBD2D7] rounded-xl max-w-xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto animate-in fade-in">
              <div className="flex items-center justify-between pb-3 border-b border-[#E2E7EC]">
                <h3 className="text-base font-bold text-[#0B1320]">Register New Client</h3>
                <button onClick={() => setShowAddModal(false)} className="text-[#586570] hover:text-[#0B1320]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateClient} className="py-4 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Business Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Metro Mobile Care"
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Contact Person</label>
                    <input
                      type="text"
                      required
                      value={formData.contactPerson}
                      onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                      placeholder="Store Manager"
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Phone Number</label>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="9845011223"
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">GST Number</label>
                    <input
                      type="text"
                      value={formData.gstNumber}
                      onChange={(e) => setFormData({ ...formData, gstNumber: e.target.value })}
                      placeholder="29ABCDE1234F1Z5"
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#0B1320] mb-1">Street Address</label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Shop #12, Market Road"
                    className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">City</label>
                    <input
                      type="text"
                      required
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">State</label>
                    <input
                      type="text"
                      required
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Pincode</label>
                    <input
                      type="text"
                      required
                      value={formData.pincode}
                      onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">GPS Latitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={formData.latitude}
                      onChange={(e) => setFormData({ ...formData, latitude: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">GPS Longitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={formData.longitude}
                      onChange={(e) => setFormData({ ...formData, longitude: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Credit Limit (₹)</label>
                    <input
                      type="number"
                      value={formData.creditLimit}
                      onChange={(e) => setFormData({ ...formData, creditLimit: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#0B1320] mb-1">Opening Balance (₹)</label>
                    <input
                      type="number"
                      value={formData.openingBalance}
                      onChange={(e) => setFormData({ ...formData, openingBalance: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#081224]"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-[#E2E7EC]">
                  <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" type="submit">
                    Save Account
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
