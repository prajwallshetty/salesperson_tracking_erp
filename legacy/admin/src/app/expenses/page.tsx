'use client';

import React, { useState, useEffect } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import {
  Receipt,
  CheckCircle2,
  XCircle,
  Clock,
  Banknote,
  Search,
  Filter,
  Download,
  Eye,
  AlertCircle,
  FileText,
  Calendar,
  User,
  ArrowRight,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES } from '@/shared';

export default function ExpensesPage() {
  const { token, user } = useAuth();
  const { socket, lastEvent } = useSocket();

  const [expenses, setExpenses] = useState<any[]>([]);
  const [stats, setStats] = useState({
    pendingCount: 0,
    pendingTotal: 0,
    approvedTotal: 0,
    reimbursedTotal: 0,
    totalCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [inspectExpense, setInspectExpense] = useState<any | null>(null);
  const [approveModal, setApproveModal] = useState<any | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [rejectModal, setRejectModal] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reimburseModal, setReimburseModal] = useState<any | null>(null);
  const [reimbursementRef, setReimbursementRef] = useState('');
  const [reimbursementMethod, setReimbursementMethod] = useState('BANK_TRANSFER');
  const [reimburseComment, setReimburseComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchExpenses = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      if (selectedStatus !== 'ALL') queryParams.append('status', selectedStatus);
      if (selectedCategory !== 'ALL') queryParams.append('category', selectedCategory);
      if (searchQuery.trim()) queryParams.append('search', searchQuery.trim());
      queryParams.append('limit', '100');

      const res = await fetch(`/api/expenses?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setExpenses(data.data || []);
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (err) {
      console.error('Failed to fetch expenses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, [token, selectedStatus, selectedCategory]);

  // Real-time socket updates for expenses
  useEffect(() => {
    if (lastEvent && lastEvent.eventName.startsWith('EXPENSE_')) {
      fetchExpenses();
    }
  }, [lastEvent]);

  // Handler: Approve Claim
  const handleApprove = async () => {
    if (!approveModal) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/expenses/${approveModal.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment: approveComment.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to approve claim');
      } else {
        setApproveModal(null);
        setApproveComment('');
        fetchExpenses();
      }
    } catch (err: any) {
      setActionError(err.message || 'Connection error');
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Reject Claim
  const handleReject = async () => {
    if (!rejectModal) return;
    if (!rejectReason.trim()) {
      setActionError('A valid rejection reason is mandatory.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/expenses/${rejectModal.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rejectionReason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to reject claim');
      } else {
        setRejectModal(null);
        setRejectReason('');
        fetchExpenses();
      }
    } catch (err: any) {
      setActionError(err.message || 'Connection error');
    } finally {
      setActionLoading(false);
    }
  };

  // Handler: Reimburse Claim
  const handleReimburse = async () => {
    if (!reimburseModal) return;
    if (!reimbursementRef.trim()) {
      setActionError('Payment/Bank reference number is required.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/expenses/${reimburseModal.id}/reimburse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reimbursementRef: reimbursementRef.trim(),
          reimbursementMethod,
          comment: reimburseComment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to record reimbursement');
      } else {
        setReimburseModal(null);
        setReimbursementRef('');
        setReimburseComment('');
        fetchExpenses();
      }
    } catch (err: any) {
      setActionError(err.message || 'Connection error');
    } finally {
      setActionLoading(false);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!expenses.length) return;
    const headers = ['Expense Number,Staff Name,Employee Code,Category,Amount (INR),Date,Status,Merchant,Purpose,Receipt'];
    const rows = expenses.map((e) =>
      [
        `"${e.expenseNumber}"`,
        `"${e.salesperson?.user?.name || ''}"`,
        `"${e.salesperson?.employeeCode || ''}"`,
        `"${e.category}"`,
        e.amount,
        `"${new Date(e.expenseDate).toLocaleDateString('en-IN')}"`,
        `"${e.status}"`,
        `"${e.merchantName || ''}"`,
        `"${(e.description || '').replace(/"/g, '""')}"`,
        `"${e.receiptUrl || ''}"`,
      ].join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `staff_expenses_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper status color badges
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'SUBMITTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Submitted (Pending)
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Approved
          </span>
        );
      case 'REIMBURSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#E6F4DD] text-[#2E6819] border border-[#B4E39C]">
            <CheckCircle2 className="w-3 h-3 text-[#2E6819]" />
            Reimbursed
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-500" />
            Rejected
          </span>
        );
      case 'DRAFT':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
            Draft
          </span>
        );
    }
  };

  return (
    <AdminShell title="Staff Expense Management">
      <div className="space-y-6">
        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-[#CBD2D7] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#586570] uppercase tracking-wider">Pending Review</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-700 border border-amber-200">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-[#0B1320] tracking-tight">
                ₹{Number(stats.pendingTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-[#586570] mt-1">{stats.pendingCount || 0} claims awaiting approval</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#CBD2D7] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#586570] uppercase tracking-wider">Approved (Unpaid)</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-700 border border-blue-200">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-[#0B1320] tracking-tight">
                ₹{Number(stats.approvedTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-[#586570] mt-1">Ready for reimbursement disbursement</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#CBD2D7] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#586570] uppercase tracking-wider">Disbursed Reimbursements</span>
              <div className="w-8 h-8 rounded-lg bg-[#E6F4DD] flex items-center justify-center text-[#2E6819] border border-[#B4E39C]">
                <Banknote className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-[#0B1320] tracking-tight">
                ₹{Number(stats.reimbursedTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-[#586570] mt-1">Settled to staff bank accounts</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#CBD2D7] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#586570] uppercase tracking-wider">Total Claims Logged</span>
              <div className="w-8 h-8 rounded-lg bg-[#F5F7F8] flex items-center justify-center text-[#0B1320] border border-[#CBD2D7]">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold text-[#0B1320] tracking-tight">{stats.totalCount || expenses.length}</div>
              <p className="text-xs text-[#586570] mt-1">Across all authorized team members</p>
            </div>
          </div>
        </div>

        {/* Controls, Filters & Actions */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Status tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {['ALL', 'SUBMITTED', 'APPROVED', 'REIMBURSED', 'REJECTED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStatus(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedStatus === st
                      ? 'bg-[#081224] text-white shadow-sm'
                      : 'bg-[#F5F7F8] text-[#586570] hover:text-[#0B1320] hover:bg-[#EAEFF2]'
                  }`}
                >
                  {st === 'ALL' ? 'All Claims' : st === 'SUBMITTED' ? 'Pending Approval' : st.charAt(0) + st.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            {/* Actions: Search, Filter Category, Export */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8C9BA5]" />
                <input
                  type="text"
                  placeholder="Search staff, claim ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchExpenses()}
                  className="pl-9 pr-3 py-1.5 text-xs bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:outline-none focus:border-[#081224] w-48 lg:w-64"
                />
              </div>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                aria-label="Filter by expense category"
                className="px-3 py-1.5 text-xs bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:outline-none focus:border-[#081224]"
              >
                <option value="ALL">All Categories</option>
                {Object.values(EXPENSE_CATEGORIES).map((c) => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>

              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0B1320] bg-white border border-[#CBD2D7] rounded-lg hover:bg-[#F5F7F8] transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
            </div>
          </div>
        </div>

        {/* Expenses Table */}
        <div className="bg-white rounded-xl border border-[#CBD2D7] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F5F7F8] border-b border-[#CBD2D7] text-[#586570] font-semibold uppercase tracking-wider">
                  <th className="py-3.5 px-4">Claim ID</th>
                  <th className="py-3.5 px-4">Salesperson</th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Purpose / Merchant</th>
                  <th className="py-3.5 px-4 text-right">Amount (INR)</th>
                  <th className="py-3.5 px-4 text-center">Receipt</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CBD2D7]/60">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[#586570]">
                      Loading expense claims...
                    </td>
                  </tr>
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center">
                      <div className="w-12 h-12 rounded-full bg-[#F5F7F8] border border-[#CBD2D7] flex items-center justify-center mx-auto text-[#8C9BA5] mb-2">
                        <Receipt className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-[#0B1320]">No expense claims found</p>
                      <p className="text-xs text-[#586570] mt-0.5">Staff submitted claims will show up here for management review.</p>
                    </td>
                  </tr>
                ) : (
                  expenses.map((expense) => {
                    const isSelfClaim = Boolean(user && expense.salesperson?.user?.id === user.id);

                    return (
                      <tr key={expense.id} className="hover:bg-[#F5F7F8]/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#0B1320]">
                          {expense.expenseNumber}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#0B1320]">{expense.salesperson?.user?.name || 'Staff Member'}</div>
                          <div className="text-[11px] text-[#586570] font-mono">{expense.salesperson?.employeeCode || ''}</div>
                        </td>
                        <td className="py-3 px-4 text-[#586570] whitespace-nowrap">
                          {new Date(expense.expenseDate).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-[#F0F3F5] text-[#334155] border border-[#CBD2D7]/80">
                            {expense.category.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <div className="truncate text-[#0B1320] font-medium" title={expense.description}>
                            {expense.description || 'No description'}
                          </div>
                          {expense.merchantName && (
                            <div className="text-[11px] text-[#586570] truncate">
                              Vendor: {expense.merchantName} • {expense.paymentMethod}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#0B1320]">
                          ₹{Number(expense.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {expense.receiptUrl ? (
                            <button
                              onClick={() => setInspectExpense(expense)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#081224] bg-white border border-[#CBD2D7] px-2 py-1 rounded hover:bg-[#F5F7F8] transition-colors"
                              title="Inspect Receipt"
                            >
                              <Eye className="w-3 h-3 text-[#2E6819]" />
                              <span>View</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-[#8C9BA5]">None</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {renderStatusBadge(expense.status)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Inspect Details Button */}
                            <button
                              onClick={() => setInspectExpense(expense)}
                              className="p-1.5 text-[#586570] hover:text-[#0B1320] rounded hover:bg-gray-100 transition-colors"
                              title="View claim breakdown & audit trail"
                            >
                              <FileText className="w-4 h-4" />
                            </button>

                            {/* SUBMITTED actions */}
                            {expense.status === 'SUBMITTED' && (
                              <>
                                <button
                                  onClick={() => {
                                    setApproveModal(expense);
                                    setActionError(null);
                                  }}
                                  disabled={isSelfClaim}
                                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                                    isSelfClaim
                                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                      : 'bg-[#081224] text-white hover:bg-black'
                                  }`}
                                  title={isSelfClaim ? 'Self-approval is prohibited' : 'Approve claim'}
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectModal(expense);
                                    setActionError(null);
                                  }}
                                  disabled={isSelfClaim}
                                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                                    isSelfClaim
                                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                      : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'
                                  }`}
                                  title={isSelfClaim ? 'Self-approval is prohibited' : 'Reject claim with reason'}
                                >
                                  Reject
                                </button>
                              </>
                            )}

                            {/* APPROVED actions */}
                            {expense.status === 'APPROVED' && (
                              <button
                                onClick={() => {
                                  setReimburseModal(expense);
                                  setActionError(null);
                                }}
                                className="px-2.5 py-1 rounded text-xs font-semibold bg-[#E6F4DD] text-[#2E6819] border border-[#B4E39C] hover:bg-[#d6edc9] transition-colors"
                                title="Record bank disbursement"
                              >
                                Reimburse
                              </button>
                            )}
                          </div>
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

      {/* INSPECT RECEIPT & DETAILS MODAL */}
      {inspectExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl border border-[#CBD2D7] w-full max-w-xl overflow-hidden shadow-2xl animate-in zoom-in-95">
            <div className="px-6 py-4 border-b border-[#CBD2D7] flex items-center justify-between bg-[#F5F7F8]">
              <div>
                <h3 className="text-base font-bold text-[#0B1320]">{inspectExpense.expenseNumber}</h3>
                <p className="text-xs text-[#586570]">Staff Expense Claim & Audit Trail</p>
              </div>
              <button
                onClick={() => setInspectExpense(null)}
                className="text-[#8C9BA5] hover:text-[#0B1320] text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Receipt Image if available */}
              {inspectExpense.receiptUrl ? (
                <div className="border border-[#CBD2D7] rounded-xl overflow-hidden bg-gray-50 text-center p-2">
                  <p className="text-[11px] font-semibold text-[#586570] mb-2 uppercase tracking-wide">Receipt Attachment</p>
                  <img
                    src={inspectExpense.receiptUrl}
                    alt="Receipt"
                    className="max-h-64 object-contain mx-auto rounded-lg border border-gray-200"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <a
                    href={inspectExpense.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block mt-2 text-xs font-semibold text-[#081224] underline"
                  >
                    Open Full Receipt File
                  </a>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-[#586570] text-center">
                  No photographic receipt attached.
                </div>
              )}

              {/* Breakdown Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-[#F5F7F8] p-3 rounded-lg border border-[#CBD2D7]">
                  <span className="text-[#586570] block">Staff Representative</span>
                  <span className="font-bold text-[#0B1320] block mt-0.5">
                    {inspectExpense.salesperson?.user?.name} ({inspectExpense.salesperson?.employeeCode})
                  </span>
                </div>
                <div className="bg-[#F5F7F8] p-3 rounded-lg border border-[#CBD2D7]">
                  <span className="text-[#586570] block">Claimed Amount</span>
                  <span className="font-bold text-[#0B1320] text-sm block mt-0.5">
                    ₹{Number(inspectExpense.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="bg-[#F5F7F8] p-3 rounded-lg border border-[#CBD2D7]">
                  <span className="text-[#586570] block">Category & Date</span>
                  <span className="font-medium text-[#0B1320] block mt-0.5">
                    {inspectExpense.category.replace(/_/g, ' ')} • {new Date(inspectExpense.expenseDate).toLocaleDateString('en-IN')}
                  </span>
                </div>
                <div className="bg-[#F5F7F8] p-3 rounded-lg border border-[#CBD2D7]">
                  <span className="text-[#586570] block">Payment Method</span>
                  <span className="font-medium text-[#0B1320] block mt-0.5">
                    {inspectExpense.paymentMethod} {inspectExpense.merchantName ? `(${inspectExpense.merchantName})` : ''}
                  </span>
                </div>
              </div>

              {/* Purpose & Description */}
              <div className="bg-[#F5F7F8] p-3 rounded-lg border border-[#CBD2D7] text-xs">
                <span className="text-[#586570] font-semibold block">Business Purpose</span>
                <p className="text-[#0B1320] mt-1">{inspectExpense.businessPurpose || inspectExpense.description || 'N/A'}</p>
              </div>

              {/* Rejection reason if any */}
              {inspectExpense.rejectionReason && (
                <div className="bg-rose-50 p-3 rounded-lg border border-rose-200 text-xs text-rose-800">
                  <span className="font-bold block flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                    Rejection Reason
                  </span>
                  <p className="mt-1">{inspectExpense.rejectionReason}</p>
                </div>
              )}

              {/* Reimbursement Details if any */}
              {inspectExpense.reimbursementRef && (
                <div className="bg-[#E6F4DD] p-3 rounded-lg border border-[#B4E39C] text-xs text-[#2E6819]">
                  <span className="font-bold block flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2E6819]" />
                    Reimbursement Settlement Record
                  </span>
                  <p className="mt-1">
                    Disbursed on {new Date(inspectExpense.reimbursedAt).toLocaleDateString('en-IN')} via {inspectExpense.reimbursementMethod}
                    <br />
                    Reference: <span className="font-mono font-bold">{inspectExpense.reimbursementRef}</span>
                  </p>
                </div>
              )}

              {/* Audit History Timeline */}
              {inspectExpense.history && inspectExpense.history.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#CBD2D7]">
                  <h4 className="text-xs font-bold text-[#0B1320]">Audit Log & Revisions</h4>
                  <div className="space-y-2">
                    {inspectExpense.history.map((h: any) => (
                      <div key={h.id} className="text-[11px] p-2 bg-gray-50 border border-gray-200 rounded flex items-start justify-between">
                        <div>
                          <span className="font-semibold text-[#0B1320]">{h.action}</span>
                          {h.comment && <p className="text-[#586570] mt-0.5">{h.comment}</p>}
                        </div>
                        <span className="text-[10px] text-[#8C9BA5] whitespace-nowrap">
                          {new Date(h.createdAt).toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-[#CBD2D7] bg-[#F5F7F8] flex justify-end">
              <button
                onClick={() => setInspectExpense(null)}
                className="px-4 py-2 text-xs font-semibold bg-white border border-[#CBD2D7] text-[#0B1320] rounded-lg hover:bg-gray-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPROVE MODAL */}
      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl border border-[#CBD2D7] w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#CBD2D7] bg-[#F5F7F8]">
              <h3 className="text-base font-bold text-[#0B1320]">Approve Expense Claim</h3>
              <p className="text-xs text-[#586570]">Authorize ₹{Number(approveModal.amount).toLocaleString('en-IN')} for {approveModal.salesperson?.user?.name}</p>
            </div>

            <div className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {actionError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Approval Comment (Optional)
                </label>
                <textarea
                  value={approveComment}
                  onChange={(e) => setApproveComment(e.target.value)}
                  placeholder="e.g. Verified client visit transport receipts."
                  className="w-full text-xs p-3 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-[#081224] h-24"
                />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 text-xs text-blue-800 rounded-lg">
                Once approved, the financial claim will be locked and placed in the queue for bank reimbursement disbursement.
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#CBD2D7] bg-[#F5F7F8] flex justify-end gap-3">
              <button
                onClick={() => setApproveModal(null)}
                className="px-4 py-2 text-xs font-semibold bg-white border border-[#CBD2D7] text-[#0B1320] rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-semibold bg-[#081224] text-white rounded-lg hover:bg-black disabled:opacity-50"
              >
                {actionLoading ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl border border-[#CBD2D7] w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#CBD2D7] bg-[#F5F7F8]">
              <h3 className="text-base font-bold text-rose-700">Reject Expense Claim</h3>
              <p className="text-xs text-[#586570]">Claim {rejectModal.expenseNumber} (₹{Number(rejectModal.amount).toLocaleString('en-IN')})</p>
            </div>

            <div className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {actionError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Reason for Rejection <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Receipt is unreadable / Route not matching client visit schedule."
                  className="w-full text-xs p-3 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-rose-500 h-24"
                />
                <p className="text-[11px] text-[#586570] mt-1">
                  The salesperson will see this reason and may edit and resubmit their draft.
                </p>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#CBD2D7] bg-[#F5F7F8] flex justify-end gap-3">
              <button
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 text-xs font-semibold bg-white border border-[#CBD2D7] text-[#0B1320] rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting...' : 'Reject Claim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REIMBURSEMENT MODAL */}
      {reimburseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl border border-[#CBD2D7] w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-[#CBD2D7] bg-[#F5F7F8]">
              <h3 className="text-base font-bold text-[#0B1320]">Disburse Reimbursement</h3>
              <p className="text-xs text-[#586570]">
                Record payment of ₹{Number(reimburseModal.amount).toLocaleString('en-IN')} to {reimburseModal.salesperson?.user?.name}
              </p>
            </div>

            <div className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 rounded-lg">
                  {actionError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Payment Reference / UTR Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={reimbursementRef}
                  onChange={(e) => setReimbursementRef(e.target.value)}
                  placeholder="e.g. UTR-98234871239 or CHQ-0021"
                  className="w-full text-xs p-2.5 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-[#081224]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Disbursement Channel
                </label>
                <select
                  value={reimbursementMethod}
                  onChange={(e) => setReimbursementMethod(e.target.value)}
                  className="w-full text-xs p-2.5 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-[#081224]"
                >
                  <option value="BANK_TRANSFER">NEFT / RTGS Bank Transfer</option>
                  <option value="UPI">Corporate UPI</option>
                  <option value="COMPANY_CARD">Company Credit Card</option>
                  <option value="PETTY_CASH">Petty Cash</option>
                  <option value="CHEQUE">Cheque</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B1320] mb-1">
                  Settlement Note (Optional)
                </label>
                <input
                  type="text"
                  value={reimburseComment}
                  onChange={(e) => setReimburseComment(e.target.value)}
                  placeholder="e.g. Cleared via payroll batch 09/2026."
                  className="w-full text-xs p-2.5 bg-[#F5F7F8] border border-[#CBD2D7] rounded-lg focus:outline-none focus:border-[#081224]"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 text-xs text-amber-800 rounded-lg">
                Financial Note: Recording reimbursement stores the audit record and updates the claim status. Actual fund transfers take place through your organization's banking channel.
              </div>
            </div>

            <div className="px-6 py-3 border-t border-[#CBD2D7] bg-[#F5F7F8] flex justify-end gap-3">
              <button
                onClick={() => setReimburseModal(null)}
                className="px-4 py-2 text-xs font-semibold bg-white border border-[#CBD2D7] text-[#0B1320] rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleReimburse}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-semibold bg-[#2E6819] text-white rounded-lg hover:bg-[#235213] disabled:opacity-50"
              >
                {actionLoading ? 'Recording...' : 'Disburse & Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
