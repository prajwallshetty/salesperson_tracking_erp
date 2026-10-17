'use client';

import { SOCKET_EVENTS } from '@/lib/domain/constants';
import { useRealtimeRefresh } from '@/components/shared/RealtimeProvider';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useField } from '@/features/field/FieldProvider';
import { useSession } from '@/components/shared/SessionProvider';
import { newId, readJson } from '@/features/field/storage';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { Card, Chip, EmptyState, Field, Notice, PrimaryButton, Sheet, SkeletonList, StatusPill, inputClass } from '@/components/sales/mobile';
import FileAttach from '@/components/sales/FileAttach';
import { formatDateTime, humanize, inr } from '@/lib/client/format';
import DocLink from '@/components/shared/DocLink';

const METHODS = ['UPI', 'CASH', 'BANK_TRANSFER', 'CHEQUE'] as const;

function CollectInner() {
  const { user } = useSession();
  const { submit, online } = useField();
  const params = useSearchParams();
  const [payments, setPayments] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('UPI');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ offline: boolean; payment?: any; clientName: string; amount: number } | null>(null);
  // One key per form: a retried/double-tapped submit replays instead of duplicating the collection.
  const key = useRef(`payment-${newId()}`);
  const cacheKey = `sg_cache_${user!.id}_clients`;

  const load = useCallback(async () => {
    try {
      setPayments((await apiJson<{ data: any[] }>('/api/payments?limit=50')).data);
      setError(null);
    } catch (err) {
      setPayments((p) => p ?? []);
      setError(errorMessage(err));
    }
  }, []);

  useRealtimeRefresh(load, [SOCKET_EVENTS.PAYMENT_VERIFIED]);

  useEffect(() => {
    load();
    apiJson<{ data: any[] }>('/api/clients?limit=500')
      .then((r) => setClients(r.data))
      .catch(() => setClients(readJson<{ data: any[] } | null>(cacheKey, null)?.data || []));
  }, [load, cacheKey]);

  useEffect(() => {
    if (params.get('clientId')) {
      setClientId(params.get('clientId')!);
      setOpen(true);
    }
  }, [params]);

  const client = clients.find((c) => c.id === clientId);

  const collect = async () => {
    setFormError(null);
    const value = Number(amount);
    if (!clientId) return setFormError('Choose a client.');
    if (!value || value <= 0) return setFormError('Enter an amount greater than zero.');
    setBusy(true);
    const res = await submit<{ data: any }>({
      url: '/api/payments',
      body: {
        clientId,
        amount: value,
        paymentMethod: method,
        transactionReference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        proofUrl: proofUrl || undefined,
        collectedAt: new Date().toISOString(),
      },
      type: 'PAYMENT',
      label: `Collection ${inr(value)} — ${client?.name || 'client'}`,
      idempotencyKey: key.current,
    });
    setBusy(false);
    if (!res.ok) return setFormError(res.error);
    setReceipt({ offline: res.offline, payment: res.data?.data, clientName: client?.name || '', amount: value });
    key.current = `payment-${newId()}`;
    setAmount('');
    setReference('');
    setNotes('');
    setProofUrl('');
    setOpen(false);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-[#0B1320]">Collections</h1>
        <button onClick={() => setOpen(true)} className="min-h-[40px] px-4 rounded-xl bg-[#081224] text-white text-xs font-bold">
          + Collect payment
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {payments === null ? (
        <SkeletonList />
      ) : payments.length === 0 ? (
        <EmptyState title="No collections yet" />
      ) : (
        <ul className="space-y-3">
          {payments.map((p) => (
            <li key={p.id}>
              <Card>
                <div className="flex justify-between items-start">
                  <p className="text-sm font-bold">{p.receiptNumber}</p>
                  <StatusPill status={p.status} />
                </div>
                <p className="text-xs text-[#586570]">{p.clientName}</p>
                <p className="text-[11px] text-[#80909D]">
                  {formatDateTime(p.collectedAt)} · {humanize(p.paymentMethod)}
                  {p.transactionReference ? ` · Ref ${p.transactionReference}` : ''}
                </p>
                <div className="flex justify-between mt-2 pt-2 border-t border-[#E2E7EC] text-xs items-center">
                  <DocLink href={`/api/payments/${p.id}/receipt-pdf`} filename={`receipt-${p.receiptNumber || p.id}.pdf`} className="text-[#259DC3] font-semibold">
                    Receipt PDF
                  </DocLink>
                  <span className="font-bold text-sm">{inr(p.amount, 2)}</span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} title="Collect payment" onClose={() => setOpen(false)} footer={<PrimaryButton onClick={collect} loading={busy}>Record collection</PrimaryButton>}>
        <div className="space-y-4">
          <Field label="Client" htmlFor="pay-client">
            <select id="pay-client" className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — due {inr(c.currentOutstanding)}
                </option>
              ))}
            </select>
          </Field>
          {client && (
            <p className="text-xs text-[#586570]">
              Verified outstanding: <strong>{inr(client.currentOutstanding, 2)}</strong>
            </p>
          )}
          <Field label="Amount collected (₹)" htmlFor="pay-amount">
            <input id="pay-amount" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 10000" />
          </Field>
          <div>
            <p className="text-xs font-semibold mb-1.5">Payment method</p>
            <div className="flex flex-wrap gap-2">
              {METHODS.map((m) => (
                <Chip key={m} active={method === m} onClick={() => setMethod(m)}>
                  {humanize(m)}
                </Chip>
              ))}
            </div>
          </div>
          <Field label="Transaction reference / UTR / cheque number" htmlFor="pay-ref">
            <input id="pay-ref" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Remarks" htmlFor="pay-notes">
            <input id="pay-notes" className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FileAttach label="Proof (optional)" value={proofUrl} onChange={setProofUrl} disabled={!online} />
          <p className="text-[11px] text-[#80909D]">
            Collections stay <strong>pending</strong> until verified by your manager or accounts team; only verified amounts reduce the client&apos;s balance.
          </p>
          {formError && <Notice tone="error">{formError}</Notice>}
        </div>
      </Sheet>

      <Sheet open={receipt !== null} title={receipt?.offline ? 'Saved offline' : 'Payment received'} onClose={() => setReceipt(null)} footer={<PrimaryButton onClick={() => setReceipt(null)}>Done</PrimaryButton>}>
        {receipt?.offline ? (
          <Notice tone="warning">
            No connection. The collection of {inr(receipt.amount, 2)} from {receipt.clientName} is saved on this device. A receipt number is issued once it syncs — do not hand over a receipt until then.
          </Notice>
        ) : receipt?.payment ? (
          <dl className="text-sm divide-y divide-[#E2E7EC]">
            {[
              ['Receipt number', receipt.payment.receiptNumber],
              ['Client', receipt.clientName],
              ['Amount', inr(receipt.payment.amount, 2)],
              ['Method', humanize(receipt.payment.paymentMethod)],
              ['Status', receipt.payment.status],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2">
                <dt className="text-[#586570]">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
            <div className="pt-3">
              <DocLink href={`/api/payments/${receipt.payment.id}/receipt-pdf`} filename="receipt.pdf" className="text-[#259DC3] font-semibold">
                Open PDF receipt
              </DocLink>
            </div>
          </dl>
        ) : null}
      </Sheet>
    </div>
  );
}

export default function FieldCollect() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <CollectInner />
    </Suspense>
  );
}
