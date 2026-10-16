'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminShell from '@/components/layout/AdminShell';
import WorkflowStepper from '@/components/ui/WorkflowStepper';
import BackLink from '@/components/ui/BackLink';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  CreditCard,
  Search,
  CheckCircle2,
  XCircle,
  FileText,
  ShieldCheck,
  Clock,
  IndianRupee,
  Download,
  Plus,
  ArrowRight,
  ArrowLeft,
  Building2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl } from '@/config/api';

const PAYMENT_STEPS = [
  { id: 'client', label: 'Client' },
  { id: 'amount-method', label: 'Amount & Method' },
  { id: 'proof-reference', label: 'Proof / Reference' },
  { id: 'review', label: 'Review' },
  { id: 'receipt', label: 'Receipt' },
];

function PaymentsContent() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const initialNew = searchParams.get('new') === 'true';
  const { token } = useAuth();

  const [payments, setPayments] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Multi-step Payment Collection Wizard Mode
  const [isRecordingPayment, setIsRecordingPayment] = useState(initialNew);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Form State
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE'>('UPI');
  const [transactionRef, setTransactionRef] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [createdReceipt, setCreatedReceipt] = useState<any>(null);

  const fetchPayments = async () => {
    if (!token) return;
    try {
      let url = `/api/payments?search=${encodeURIComponent(search)}`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setPayments(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/clients', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setClients(json.data || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [token, statusFilter, search]);

  useEffect(() => {
    if (isRecordingPayment && clients.length === 0) {
      fetchClients();
    }
  }, [isRecordingPayment, token]);

  const handleVerify = async (id: string, status: 'VERIFIED' | 'REJECTED') => {
    if (!confirm(`Are you sure you want to mark this payment as ${status}?`)) return;
    try {
      const res = await fetch(`/api/payments/${id}/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes: `Reviewed by administrator` }),
      });

      if (res.ok) {
        fetchPayments();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to update payment status');
      }
    } catch (e: any) {
      alert(e.message || 'Error updating payment');
    }
  };

  const handleDownloadPdf = (id: string) => {
    if (!token) return;
    window.open(getApiUrl(`/api/payments/${id}/receipt-pdf?token=${token}`), '_blank');
  };

  const handleSubmitPayment = async () => {
    if (!selectedClient || !amount || Number(amount) <= 0) return;
    setSubmittingPayment(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          amount: Number(amount),
          paymentMethod,
          transactionReference: transactionRef,
          notes: paymentNotes,
          idempotencyKey: `pay-web-${Date.now()}`,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setCreatedReceipt(json.data);
        setCurrentStepIndex(4); // Receipt step
        fetchPayments();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to record payment');
      }
    } catch (e: any) {
      alert(e.message || 'Error recording payment');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const resetWizard = () => {
    setIsRecordingPayment(false);
    setCurrentStepIndex(0);
    setSelectedClient(null);
    setAmount('');
    setPaymentMethod('UPI');
    setTransactionRef('');
    setPaymentNotes('');
    setCreatedReceipt(null);
  };

  return (
    <AdminShell title="Collections & Receipts">
      <div className="space-y-6 max-w-7xl">
        {/* If in multi-step wizard mode */}
        {isRecordingPayment ? (
          <div>
            <BackLink
              href="#"
              label="Back to collections list"
              className="cursor-pointer"
              onClick={(e: any) => {
                e.preventDefault();
                resetWizard();
              }}
            />

            {/* Stepper Panel (Reference Style) */}
            <WorkflowStepper
              steps={PAYMENT_STEPS}
              currentStepIndex={currentStepIndex}
              onStepClick={(idx) => setCurrentStepIndex(idx)}
              className="mb-6"
            />

            {/* Step Form Panel */}
            <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 md:p-8">
              {/* Step 0: Select Client */}
              {currentStepIndex === 0 && (
                <div>
                  <h2 className="text-xl font-bold text-[#0B1320] mb-1">Select Customer Account</h2>
                  <p className="text-xs text-[#586570] mb-6">Choose the registered client making this payment.</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto p-1">
                    {clients.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => setSelectedClient(c)}
                        className={`p-4 rounded-xl border text-left cursor-pointer transition-all ${
                          selectedClient?.id === c.id
                            ? 'border-[#081224] bg-[#F3F5F6] ring-1 ring-[#081224]'
                            : 'border-[#CBD2D7] hover:border-[#80909D] bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm text-[#0B1320]">{c.name}</p>
                          <span className="text-[11px] font-mono text-[#586570]">{c.city}</span>
                        </div>
                        <p className="text-xs text-[#586570] mt-1">{c.contactPerson} • {c.phone}</p>
                        <p className="text-xs text-[#2E6819] mt-2 font-semibold">
                          Current Ledger Outstanding: ₹{Number(c.currentOutstanding || 0).toLocaleString('en-IN')}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={resetWizard}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!selectedClient}
                      onClick={() => setCurrentStepIndex(1)}
                      icon={<ArrowRight className="w-4 h-4" />}
                    >
                      Continue to Amount
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 1: Amount & Method */}
              {currentStepIndex === 1 && (
                <div>
                  <h2 className="text-xl font-bold text-[#0B1320] mb-1">Enter Amount & Collection Mode</h2>
                  <p className="text-xs text-[#586570] mb-6">
                    Customer: <strong className="text-[#0B1320]">{selectedClient?.name}</strong> (Outstanding: ₹{Number(selectedClient?.currentOutstanding || 0).toLocaleString('en-IN')})
                  </p>

                  <div className="space-y-5 max-w-md">
                    <div>
                      <label className="block text-xs font-semibold text-[#0B1320] mb-1.5">Collection Amount (₹)</label>
                      <input
                        type="number"
                        placeholder="e.g., 25000"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full bg-white border border-[#CBD2D7] rounded-xl p-3 text-sm text-[#0B1320] font-semibold focus:ring-1 focus:ring-[#081224] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0B1320] mb-2">Payment Instrument / Method</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['UPI', 'CASH', 'BANK_TRANSFER', 'CHEQUE'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setPaymentMethod(m)}
                            className={`p-3 rounded-lg border text-xs font-semibold text-center transition-colors ${
                              paymentMethod === m
                                ? 'bg-[#081224] text-white border-[#081224]'
                                : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
                            }`}
                          >
                            {m.replace('_', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center mt-8 pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={() => setCurrentStepIndex(0)} icon={<ArrowLeft className="w-4 h-4" />}>
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!amount || Number(amount) <= 0}
                      onClick={() => setCurrentStepIndex(2)}
                      icon={<ArrowRight className="w-4 h-4" />}
                    >
                      Continue to Proof
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Proof / Reference */}
              {currentStepIndex === 2 && (
                <div>
                  <h2 className="text-xl font-bold text-[#0B1320] mb-1">Transaction Details & Proof</h2>
                  <p className="text-xs text-[#586570] mb-6">Enter reference identifier and settlement remarks.</p>

                  <div className="space-y-4 max-w-md">
                    <div>
                      <label className="block text-xs font-semibold text-[#0B1320] mb-1.5">
                        Transaction Reference / UTR / Cheque #
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., UPI/2026/987123"
                        value={transactionRef}
                        onChange={(e) => setTransactionRef(e.target.value)}
                        className="w-full bg-white border border-[#CBD2D7] rounded-xl p-3 text-xs text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0B1320] mb-1.5">Collection Remarks & Notes</label>
                      <textarea
                        rows={3}
                        placeholder="e.g., Cheque handed over during store visit."
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        className="w-full bg-white border border-[#CBD2D7] rounded-xl p-3 text-xs text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center mt-8 pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={() => setCurrentStepIndex(1)} icon={<ArrowLeft className="w-4 h-4" />}>
                      Back
                    </Button>
                    <Button variant="primary" onClick={() => setCurrentStepIndex(3)} icon={<ArrowRight className="w-4 h-4" />} >
                      Review Summary
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Review */}
              {currentStepIndex === 3 && (
                <div>
                  <h2 className="text-xl font-bold text-[#0B1320] mb-1">Review Voucher Details</h2>
                  <p className="text-xs text-[#586570] mb-6">Review collection before issuing provisional receipt voucher.</p>

                  <div className="bg-[#F3F5F6] border border-[#CBD2D7] rounded-xl p-5 mb-6 space-y-3 max-w-lg">
                    <div className="flex justify-between text-xs text-[#586570]">
                      <span>Customer</span>
                      <span className="font-semibold text-[#0B1320]">{selectedClient?.name}</span>
                    </div>

                    <div className="flex justify-between text-xs text-[#586570]">
                      <span>Payment Instrument</span>
                      <span className="font-semibold text-[#0B1320]">{paymentMethod}</span>
                    </div>

                    <div className="flex justify-between text-xs text-[#586570]">
                      <span>Reference ID</span>
                      <span className="font-mono text-[#0B1320]">{transactionRef || 'N/A'}</span>
                    </div>

                    <div className="pt-3 border-t border-[#CBD2D7] flex justify-between text-sm font-bold text-[#0B1320]">
                      <span>Collection Total</span>
                      <span className="text-[#2E6819]">₹{Number(amount).toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[#E6F4DD] border border-[#B4E39C] text-xs text-[#2E6819] mb-6 max-w-lg">
                    Note: Payment will enter <strong>PENDING</strong> status. It will not reduce verified ledger debt until verified.
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t border-[#E2E7EC]">
                    <Button variant="secondary" onClick={() => setCurrentStepIndex(2)} icon={<ArrowLeft className="w-4 h-4" />}>
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      disabled={submittingPayment}
                      onClick={handleSubmitPayment}
                      icon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      {submittingPayment ? 'Recording...' : 'Generate Receipt'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Receipt */}
              {currentStepIndex === 4 && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-[#E6F4DD] border border-[#B4E39C] text-[#2E6819] flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold text-[#0B1320]">Receipt Voucher Created!</h2>
                  <p className="text-sm font-semibold text-[#259DC3] mt-1 font-mono">
                    {createdReceipt?.receiptNumber || 'PAY-2026-00000'}
                  </p>
                  <p className="text-xs text-[#586570] mt-2 max-w-md mx-auto">
                    A provisional receipt voucher has been recorded. You can download the electronic PDF receipt now or proceed to verification.
                  </p>

                  <div className="mt-8 flex justify-center gap-3">
                    {createdReceipt && (
                      <Button
                        variant="secondary"
                        onClick={() => handleDownloadPdf(createdReceipt.id)}
                        icon={<Download className="w-4 h-4" />}
                      >
                        Download PDF Receipt
                      </Button>
                    )}
                    <Button variant="primary" onClick={resetWizard}>
                      Return to Collections List
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Normal List View */
          <>
            {/* Header & Filter Bar */}
            <div className="bg-white border border-[#CBD2D7] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold tracking-wider uppercase text-[#586570]">
                  Treasury & Collections
                </span>
                <h1 className="text-xl md:text-2xl font-bold text-[#0B1320] mt-0.5">
                  Payment Collections & Verification
                </h1>
                <p className="text-xs text-[#586570] mt-1">
                  Reconcile field cash, UPI, and bank transfers before posting double-entry credits to client ledgers.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  id="btn-record-collection"
                  variant="primary"
                  size="md"
                  onClick={() => setIsRecordingPayment(true)}
                  icon={<Plus className="w-4 h-4" />}
                >
                  Record Collection
                </Button>
              </div>
            </div>

            {/* Filter Tabs & Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {[
                  { id: '', label: 'All Collections' },
                  { id: 'PENDING', label: 'Pending Verification' },
                  { id: 'VERIFIED', label: 'Verified' },
                  { id: 'REJECTED', label: 'Rejected' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      statusFilter === tab.id
                        ? 'bg-[#081224] text-white border-[#081224]'
                        : 'bg-white text-[#586570] border-[#CBD2D7] hover:bg-[#F3F5F6]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#80909D]" />
                <input
                  type="text"
                  placeholder="Search receipt #, ref, client..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-4 py-1.5 text-xs bg-white border border-[#CBD2D7] rounded-lg text-[#0B1320] focus:ring-1 focus:ring-[#081224] focus:outline-none w-64"
                />
              </div>
            </div>

            {/* Payments Table */}
            <div className="bg-white border border-[#CBD2D7] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                      <th className="py-3 px-4">Receipt #</th>
                      <th className="py-3 px-4">Client</th>
                      <th className="py-3 px-4">Salesperson</th>
                      <th className="py-3 px-4">Mode & Ref</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E7EC]">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#80909D]">
                          Loading collections...
                        </td>
                      </tr>
                    ) : payments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#80909D]">
                          No payment collections found.
                        </td>
                      </tr>
                    ) : (
                      payments.map((p) => (
                        <tr key={p.id} className="hover:bg-[#F3F5F6]/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-[#0B1320]">
                            {p.receiptNumber}
                          </td>
                          <td className="py-3 px-4 font-medium text-[#0B1320]">{p.clientName}</td>
                          <td className="py-3 px-4 text-[#586570]">
                            {p.salespersonName}{' '}
                            <span className="text-[10px] text-[#80909D]">({p.salespersonCode})</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-[#0B1320]">{p.paymentMethod}</span>
                            {p.transactionReference && (
                              <p className="text-[10px] font-mono text-[#586570]">{p.transactionReference}</p>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-[#0B1320]">
                            ₹{Number(p.amount).toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4 text-[#586570]">
                            {new Date(p.collectedAt).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={p.status} />
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-2">
                              {p.status === 'PENDING' && (
                                <>
                                  <button
                                    onClick={() => handleVerify(p.id, 'VERIFIED')}
                                    className="p-1 rounded bg-[#E6F4DD] text-[#2E6819] border border-[#B4E39C] hover:bg-[#D4EFC3]"
                                    title="Verify & Post Credit"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleVerify(p.id, 'REJECTED')}
                                    className="p-1 rounded bg-[#FDF2F2] text-[#991B1B] border border-[#F8C4C4] hover:bg-[#FCE8E8]"
                                    title="Reject Payment"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => handleDownloadPdf(p.id)}
                                className="p-1 rounded text-[#586570] hover:text-[#0B1320] hover:bg-[#F3F5F6] border border-[#CBD2D7]"
                                title="Download PDF Voucher"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-[#586570]">Loading collections module...</div>}>
      <PaymentsContent />
    </Suspense>
  );
}
