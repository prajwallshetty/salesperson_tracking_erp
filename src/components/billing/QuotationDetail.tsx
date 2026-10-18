'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, FilePlus2, GitBranch, Pencil, Send, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import BackLink from '@/components/ui/BackLink';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import DocumentView, { HistoryList } from './DocumentView';
import PdfActions from './PdfActions';
import { ReasonDialog } from './Dialogs';
import { fmtDate, inr } from './format';

export default function QuotationDetail({ id }: { id: string }) {
  const router = useRouter();
  const [q, setQ] = useState<any>(null);
  const [business, setBusiness] = useState<string>('Bharath Interior Decor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'reject' | 'delete'>(null);

  const load = useCallback(async () => {
    try {
      const [{ data }, biz] = await Promise.all([apiJson<{ data: any }>(`/api/quotations/${id}`), apiJson<{ data: any }>('/api/billing/business')]);
      setQ(data);
      setBusiness(biz.data.displayName);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string, json?: unknown) => apiJson<any>(`/api/quotations/${id}/${path}`, { method: 'POST', json: json ?? {} });

  if (!q) return error ? <p role="alert" className="text-sm text-[#991B1B]">{error}</p> : <p className="text-sm text-[#80909D]">Loading…</p>;

  const convertedInvoice = (q.invoices ?? []).find((i: any) => i.status !== 'CANCELLED');
  const latestRevision = q.revisions[q.revisions.length - 1];
  const label = `Quotation ${q.number}${q.revision > 1 ? ` (Rev ${q.revision})` : ''}`;

  return (
    <div className="space-y-5 max-w-5xl">
      <BackLink href="/quotations" label="All quotations" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#0B1320] flex items-center gap-2 flex-wrap">
            {label} <StatusBadge status={q.status} />
          </h2>
          <p className="text-xs text-[#586570] mt-1">
            Dated {fmtDate(q.quotationDate)} · valid until {fmtDate(q.validUntil)} · <strong className="text-[#0B1320]">{inr(q.grandTotal)}</strong>
          </p>
          {q.rejectionReason && <p className="text-xs text-[#991B1B] mt-1">Rejected: {q.rejectionReason}</p>}
          {q.status === 'REVISED' && latestRevision && latestRevision.id !== q.id && (
            <p className="text-xs mt-1">Superseded — <Link className="underline" href={`/quotations/${latestRevision.id}`}>see revision {latestRevision.revision}</Link></p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {q.status === 'DRAFT' && (
            <>
              <Link href={`/quotations/${id}/edit`}><Button variant="secondary" icon={<Pencil className="w-3.5 h-3.5" />}>Edit</Button></Link>
              <Button icon={<Send className="w-3.5 h-3.5" />} disabled={busy} onClick={() => act(async () => { await post('send'); await load(); })}>Mark as sent</Button>
            </>
          )}
          {q.status === 'SENT' && (
            <>
              <Button disabled={busy} onClick={() => act(async () => { await post('respond', { decision: 'ACCEPTED' }); await load(); })}>Mark accepted</Button>
              <Button variant="destructive" disabled={busy} onClick={() => setDialog('reject')}>Mark rejected</Button>
            </>
          )}
          {q.status === 'ACCEPTED' && (convertedInvoice ? (
            <Link href={`/invoices/${convertedInvoice.id}`}><Button icon={<FilePlus2 className="w-3.5 h-3.5" />}>Open invoice {convertedInvoice.number ?? '(draft)'}</Button></Link>
          ) : (
            <Button icon={<FilePlus2 className="w-3.5 h-3.5" />} disabled={busy} onClick={() => act(async () => { const r = await post('convert'); router.push(`/invoices/${r.data.id}`); })}>Convert to invoice</Button>
          ))}
          {['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'].includes(q.status) && !(q.status === 'ACCEPTED' && convertedInvoice) && (
            <Button variant="secondary" icon={<GitBranch className="w-3.5 h-3.5" />} disabled={busy} onClick={() => act(async () => { const r = await post('revise'); router.push(`/quotations/${r.data.id}`); })}>Revise</Button>
          )}
          <Button variant="secondary" icon={<Copy className="w-3.5 h-3.5" />} disabled={busy} onClick={() => act(async () => { const r = await post('duplicate'); router.push(`/quotations/${r.data.id}`); })}>Duplicate</Button>
          {q.status === 'DRAFT' && q.revision === 1 && <Button variant="destructive" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setDialog('delete')}>Delete</Button>}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-[#991B1B]">{error}</p>}

      <PdfActions pdfPath={`/api/quotations/${id}/pdf`} filename={`Quotation-${q.number}.pdf`} label={label} customerName={q.customerName} phone={q.customerPhone} email={q.customerEmail} total={Number(q.grandTotal)} businessName={business} />

      <DocumentView doc={q} />

      {q.revisions.length > 1 && (
        <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5">
          <h2 className="text-sm font-bold text-[#0B1320] mb-3">Revisions</h2>
          <ul className="divide-y divide-[#E2E7EC] text-xs">
            {q.revisions.map((r: any) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <span>
                  <Link className={`underline ${r.id === id ? 'font-bold' : ''}`} href={`/quotations/${r.id}`}>Revision {r.revision}</Link>
                  <span className="text-[#80909D]"> · {fmtDate(r.quotationDate)} · {inr(r.grandTotal)}</span>
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <HistoryList history={q.history} />

      {dialog === 'reject' && (
        <ReasonDialog title="Mark as rejected" description="Record why the customer declined." confirmLabel="Mark rejected" destructive onClose={() => setDialog(null)} onSubmit={async (reason) => { await post('respond', { decision: 'REJECTED', reason }); setDialog(null); await load(); }} />
      )}
      {dialog === 'delete' && (
        <ReasonDialog title="Delete draft quotation" description="This permanently removes the draft. Its number will not be reused." confirmLabel="Delete" optional destructive onClose={() => setDialog(null)} onSubmit={async () => { await apiJson(`/api/quotations/${id}`, { method: 'DELETE' }); router.push('/quotations'); }} />
      )}
    </div>
  );
}
