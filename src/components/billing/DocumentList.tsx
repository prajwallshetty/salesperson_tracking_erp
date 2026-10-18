'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { INVOICE_STATUSES, QUOTATION_STATUSES, fmtDate, inr } from './format';
import type { DocKind } from './DocumentEditor';

const field = 'px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-sm focus:ring-1 focus:ring-[#000000] focus:outline-none';
const PAGE = 25;

const SORTS: Record<DocKind, { value: string; label: string }[]> = {
  quotation: [
    { value: 'created', label: 'Newest first' },
    { value: 'date', label: 'Quotation date' },
    { value: 'number', label: 'Number' },
    { value: 'customer', label: 'Customer' },
    { value: 'total', label: 'Amount' },
    { value: 'validUntil', label: 'Valid until' },
  ],
  invoice: [
    { value: 'created', label: 'Newest first' },
    { value: 'date', label: 'Invoice date' },
    { value: 'number', label: 'Number' },
    { value: 'customer', label: 'Customer' },
    { value: 'total', label: 'Amount' },
    { value: 'due', label: 'Due date' },
  ],
};

export default function DocumentList({ kind }: { kind: DocKind }) {
  const isQuote = kind === 'quotation';
  const base = isQuote ? '/quotations' : '/invoices';
  const initialStatus = useSearchParams().get('status') ?? '';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('created');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ billed: number; collected: number; outstanding: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => setStatus(initialStatus), [initialStatus]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE), sort, dir });
    if (q.trim()) p.set('q', q.trim());
    if (status) p.set('status', status);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    try {
      const res = await apiJson<{ data: any[]; total: number; summary?: any }>(`/api${base}?${p}`);
      setRows(res.data);
      setTotal(res.total);
      setSummary(res.summary ?? null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [base, q, status, from, to, sort, dir, page]);

  // Debounce typing in the search box; other filters apply immediately.
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => setPage(0), [q, status, from, to, sort, dir]);

  const statuses = isQuote ? QUOTATION_STATUSES : INVOICE_STATUSES;
  const last = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#586570]">{isQuote ? 'Quotations sent to customers, with revision history.' : 'Invoices, payments and outstanding balances.'}</p>
        <Link href={`${base}/new`}>
          <Button icon={<Plus className="w-4 h-4" />}>{isQuote ? 'New quotation' : 'New invoice'}</Button>
        </Link>
      </div>

      {summary && !isQuote && (
        <div className="grid grid-cols-3 gap-3">
          {[
            ['Billed', summary.billed],
            ['Collected', summary.collected],
            ['Outstanding', summary.outstanding],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-white border border-[#CBD2D7] rounded-xl p-3 md:p-4">
              <p className="text-[11px] uppercase tracking-wide text-[#80909D]">{k}</p>
              <p className="text-base md:text-xl font-bold text-[#0B1320] mt-1">{inr(v as number)}</p>
            </div>
          ))}
          <p className="col-span-3 text-[11px] text-[#80909D] -mt-1">Totals cover issued, partly paid and paid invoices matching the filters below.</p>
        </div>
      )}

      <div className="bg-white border border-[#CBD2D7] rounded-xl p-3 md:p-4 grid gap-3 md:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#80909D]" />
          <input className={`${field} pl-9 w-full`} placeholder="Search number, customer, phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        <select className={field} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input className={field} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className={field} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <div className="flex gap-2">
          <select className={`${field} flex-1 min-w-0`} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            {SORTS[kind].map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button type="button" className={`${field} px-2`} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')} aria-label={`Sort ${dir === 'asc' ? 'descending' : 'ascending'}`}>{dir === 'asc' ? '↑' : '↓'}</button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-[#991B1B]">{error}</p>}

      <div className="bg-white border border-[#CBD2D7] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#F3F5F6] border-b border-[#CBD2D7] text-[#586570] font-semibold">
                <th className="py-3 px-4">Number</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">{isQuote ? 'Valid until' : 'Due'}</th>
                <th className="py-3 px-4 text-right">Total</th>
                {!isQuote && <th className="py-3 px-4 text-right">Outstanding</th>}
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E7EC]">
              {loading && !rows.length ? (
                <tr><td colSpan={7} className="py-8 text-center text-[#80909D]">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-[#80909D]">No {isQuote ? 'quotations' : 'invoices'} found.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[#F3F5F6]/60">
                    <td className="py-3 px-4 font-mono font-medium">
                      <Link href={`${base}/${r.id}`} className="underline decoration-[#D4AF37] underline-offset-2">
                        {r.number ?? 'Draft'}
                      </Link>
                      {isQuote && r.revision > 1 && <span className="ml-1 text-[#80909D]">rev {r.revision}</span>}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-[#0B1320]">{r.customerName}</p>
                      {r.customerPhone && <p className="text-[11px] text-[#586570]">{r.customerPhone}</p>}
                    </td>
                    <td className="py-3 px-4">{fmtDate(isQuote ? r.quotationDate : r.invoiceDate)}</td>
                    <td className="py-3 px-4">{fmtDate(isQuote ? r.validUntil : r.dueDate)}</td>
                    <td className="py-3 px-4 text-right font-semibold">{inr(r.grandTotal)}</td>
                    {!isQuote && <td className="py-3 px-4 text-right">{r.status === 'DRAFT' || r.status === 'CANCELLED' ? '—' : inr(r.outstanding)}</td>}
                    <td className="py-3 px-4"><StatusBadge status={isQuote ? r.status : r.displayStatus} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E2E7EC] text-xs text-[#586570]">
          <span>{total} {isQuote ? 'quotation' : 'invoice'}{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page + 1} of {last + 1}</span>
            <Button variant="secondary" size="sm" disabled={page >= last} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
