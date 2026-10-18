'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, CheckCircle2, FilePen, IndianRupee, Pencil, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import BackLink from '@/components/ui/BackLink';
import { useAuth } from '@/components/shared/SessionProvider';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import DocumentView, { HistoryList } from './DocumentView';
import PdfActions from './PdfActions';
import DocLink from '@/components/shared/DocLink';
import { PaymentDialog, ReasonDialog } from './Dialogs';
import { fmtDate, inr, methodLabel } from './format';

export default function InvoiceDetail({ id }: { id: string }) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const finance = hasPermission('canVerifyPayments');
  const [inv, setInv] = useState<any>(null);
  const [business, setBusiness] = useState('Bharath Interior Decor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'pay' | 'cancel' | 'correct' | 'delete' | { voidId: string; receipt: string }>(null);

  const load = useCallback(async () => {
    try {
      const [{ data }, biz] = await Promise.all([apiJson<{ data: any }>(`/api/invoices/${id}`), apiJson<{ data: any }>('/api/billing/business')]);
      setInv(data);
      setBusiness(biz.data.displayName);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!inv) return error ? <p role="alert" className="text-sm text-[#991B1B]">{error}</p> : <p className="text-sm text-[#80909D]">Loading…</p>;

  const status: string = inv.status;
  const open = status === 'ISSUED' || status === 'PARTIALLY_PAID';
  const noPayments = Number(inv.amountPaid) === 0;
  const activeCorrection = (inv.correctedBy ?? []).find((c: any) => c.status !== 'CANCELLED');
  const label = `Invoice ${inv.number ?? '(draft)'}`;

  return (
    <div className="space-y-5 max-w-5xl">
      <BackLink href="/invoices" label="All invoices" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1320] flex items-center gap-2 flex-wrap">
            {label} <StatusBadge status={inv.displayStatus} />
          </h2>
          <p className="text-xs text-[#586570] mt-1">
            Dated {fmtDate(inv.invoiceDate)} · due {fmtDate(inv.dueDate)} · <strong className="text-[#0B1320]">{inr(inv.grandTotal)}</strong>
            {status !== 'DRAFT' && status !== 'CANCELLED' && <> · balance <strong className="text-[#0B1320]">{inr(inv.outstanding)}</strong></>}
          </p>
          {inv.quotation && <p className="text-xs mt-1">From <Link className="underline" href={`/quotations/${inv.quotation.id}`}>quotation {inv.quotation.number}</Link></p>}
          {inv.corrects && <p className="text-xs mt-1">Corrects <Link className="underline" href={`/invoices/${inv.corrects.id}`}>invoice {inv.corrects.number}</Link></p>}
          {activeCorrection && <p className="text-xs mt-1">Replaced by <Link className="underline" href={`/invoices/${activeCorrection.id}`}>{activeCorrection.number ?? 'a corrected draft'}</Link></p>}
          {status === 'CANCELLED' && inv.cancelReason && <p className="text-xs text-[#991B1B] mt-1">Cancelled: {inv.cancelReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'DRAFT' && (
            <>
              <Link href={`/invoices/${id}/edit`}><Button variant="secondary" icon={<Pencil className="w-3.5 h-3.5" />}>Edit</Button></Link>
              {finance && (
                <Button icon={<CheckCircle2 className="w-3.5 h-3.5" />} disabled={busy} onClick={async () => { setBusy(true); try { await apiJson(`/api/invoices/${id}/issue`, { method: 'POST', json: {} }); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>Issue invoice</Button>
              )}
              <Button variant="destructive" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setDialog('delete')}>Delete</Button>
            </>
          )}
          {open && finance && <Button icon={<IndianRupee className="w-3.5 h-3.5" />} onClick={() => setDialog('pay')}>Record payment</Button>}
          {(open || status === 'CANCELLED') && finance && noPayments && !activeCorrection && (
            <Button variant="secondary" icon={<FilePen className="w-3.5 h-3.5" />} onClick={() => setDialog('correct')}>{status === 'CANCELLED' ? 'Create corrected copy' : 'Correct invoice'}</Button>
          )}
          {open && finance && noPayments && <Button variant="destructive" icon={<Ban className="w-3.5 h-3.5" />} onClick={() => setDialog('cancel')}>Cancel invoice</Button>}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-[#991B1B]">{error}</p>}
      {open && !noPayments && finance && (
        <p className="text-xs text-[#586570]">This invoice has recorded payments. To cancel or correct it, void those payments first (with a reason).</p>
      )}

      <PdfActions pdfPath={`/api/invoices/${id}/pdf`} filename={`Invoice-${inv.number ?? 'draft'}.pdf`} label={label} customerName={inv.customerName} phone={inv.customerPhone} email={inv.customerEmail} total={Number(inv.grandTotal)} businessName={business} />

      <DocumentView doc={inv} />

      <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5">
        <h2 className="text-sm font-bold text-[#0B1320] mb-3">Payments</h2>
        {inv.payments.length === 0 ? (
          <p className="text-xs text-[#80909D]">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-[#586570] border-b border-[#E2E7EC]">
                  <th className="py-2 pr-3">Receipt</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Method</th><th className="py-2 pr-3">Reference</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Status</th><th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E7EC]">
                {inv.payments.map((p: any) => (
                  <tr key={p.id} className={p.status === 'VOIDED' ? 'text-[#80909D]' : ''}>
                    <td className="py-2 pr-3 font-mono">{p.receiptNumber}</td>
                    <td className="py-2 pr-3">{fmtDate(p.paidOn)}</td>
                    <td className="py-2 pr-3">{methodLabel(p.method)}</td>
                    <td className="py-2 pr-3">{p.reference || '—'}</td>
                    <td className="py-2 pr-3 text-right font-medium">{inr(p.amount)}</td>
                    <td className="py-2 pr-3"><StatusBadge status={p.status} />{p.voidReason && <span className="block text-[11px] mt-0.5">{p.voidReason}</span>}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <DocLink href={`/api/invoices/${id}/payments/${p.id}/receipt`} filename={`Receipt-${p.receiptNumber}.pdf`} className="underline mr-3">Receipt</DocLink>
                      {finance && p.status === 'RECORDED' && status !== 'CANCELLED' && (
                        <button type="button" className="text-[#991B1B] underline" onClick={() => setDialog({ voidId: p.id, receipt: p.receiptNumber })}>Void</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <HistoryList history={inv.history} />

      {dialog === 'pay' && <PaymentDialog invoiceId={id} invoiceNumber={inv.number} outstanding={inv.outstanding} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await load(); }} />}
      {dialog === 'cancel' && (
        <ReasonDialog title="Cancel invoice" description="The invoice keeps its number and figures but is marked cancelled. This cannot be undone." confirmLabel="Cancel invoice" destructive onClose={() => setDialog(null)} onSubmit={async (reason) => { await apiJson(`/api/invoices/${id}/cancel`, { method: 'POST', json: { reason } }); setDialog(null); await load(); }} />
      )}
      {dialog === 'correct' && (
        <ReasonDialog title="Correct invoice" description={status === 'CANCELLED' ? 'Opens an editable copy of this invoice.' : 'The original is cancelled and an editable corrected copy is opened. The original stays on record.'} confirmLabel="Open corrected copy" onClose={() => setDialog(null)} onSubmit={async (reason) => { const r = await apiJson<any>(`/api/invoices/${id}/correct`, { method: 'POST', json: { reason } }); router.push(`/invoices/${r.data.id}`); }} />
      )}
      {dialog === 'delete' && (
        <ReasonDialog title="Delete draft invoice" description="This permanently removes the draft." confirmLabel="Delete" optional destructive onClose={() => setDialog(null)} onSubmit={async () => { await apiJson(`/api/invoices/${id}`, { method: 'DELETE' }); router.push('/invoices'); }} />
      )}
      {dialog && typeof dialog === 'object' && (
        <ReasonDialog title={`Void receipt ${dialog.receipt}`} description="The payment is kept in the record, marked voided, and the invoice balance is restored." confirmLabel="Void payment" destructive onClose={() => setDialog(null)} onSubmit={async (reason) => { await apiJson(`/api/invoices/${id}/payments/${dialog.voidId}/void`, { method: 'POST', json: { reason } }); setDialog(null); await load(); }} />
      )}
    </div>
  );
}
