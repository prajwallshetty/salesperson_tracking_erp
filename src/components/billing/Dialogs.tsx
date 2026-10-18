'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { PAYMENT_METHODS, inr, todayYmd } from './format';

const inputCls = 'w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-sm focus:ring-1 focus:ring-[#000000] focus:outline-none';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-[#000000]/40 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white border border-[#CBD2D7] rounded-xl max-w-md w-full p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-[#E2E7EC] mb-4">
          <h3 className="text-base font-bold text-[#0B1320]">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-[#586570] hover:text-[#0B1320]">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Asks for a reason, then calls `onSubmit(reason)`; shows the server's error inside the dialog. */
export function ReasonDialog({ title, description, confirmLabel, optional, destructive, onSubmit, onClose }: {
  title: string;
  description?: string;
  confirmLabel: string;
  optional?: boolean;
  destructive?: boolean;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {description && <p className="text-xs text-[#586570]">{description}</p>}
        <label className="block text-xs font-semibold text-[#0B1320]">
          Reason{optional ? ' (optional)' : ''}
          <textarea className={`${inputCls} mt-1 min-h-[80px]`} value={reason} onChange={(e) => setReason(e.target.value)} required={!optional} minLength={optional ? undefined : 3} maxLength={500} autoFocus />
        </label>
        {error && <p className="text-xs text-[#991B1B]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Back</Button>
          <Button type="submit" variant={destructive ? 'destructive' : 'primary'} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Records a payment against an invoice. The idempotency key is created once per dialog, so retries never double-record. */
export function PaymentDialog({ invoiceId, invoiceNumber, outstanding, onDone, onClose }: {
  invoiceId: string;
  invoiceNumber: string;
  outstanding: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(String(outstanding));
  const [paidOn, setPaidOn] = useState(todayYmd());
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setAmount(String(outstanding)), [outstanding]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await apiJson(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        json: { amount: Number(amount), paidOn, method, reference: reference || undefined, notes: notes || undefined, idempotencyKey: key },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Record payment — ${invoiceNumber}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <p className="text-[#586570]">Outstanding balance: <strong className="text-[#0B1320]">{inr(outstanding)}</strong></p>
        <div className="grid grid-cols-2 gap-3">
          <label className="font-semibold text-[#0B1320]">
            Amount (₹)
            <input className={`${inputCls} mt-1`} type="number" inputMode="decimal" step="0.01" min="0.01" max={outstanding} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="font-semibold text-[#0B1320]">
            Payment date
            <input className={`${inputCls} mt-1`} type="date" max={todayYmd()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
          </label>
        </div>
        <label className="block font-semibold text-[#0B1320]">
          Method
          <select className={`${inputCls} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="block font-semibold text-[#0B1320]">
          Transaction reference
          <input className={`${inputCls} mt-1`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / bank reference, cheque number" maxLength={120} />
        </label>
        <label className="block font-semibold text-[#0B1320]">
          Notes
          <input className={`${inputCls} mt-1`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </label>
        {error && <p className="text-[#991B1B]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</Button>
        </div>
      </form>
    </Modal>
  );
}
