'use client';

import React, { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { BrandMark } from '@/components/shared/Brand';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';

const inputCls = 'w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-sm focus:ring-1 focus:ring-[#000000] focus:outline-none';
const labelCls = 'block text-xs font-semibold text-[#0B1320]';

type Form = Record<string, any>;

const TEXT_FIELDS = ['legalName', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'website', 'gstin', 'pan', 'defaultPaymentTerms', 'quotationNotes', 'quotationTerms', 'invoiceNotes', 'invoiceTerms', 'bankAccountName', 'bankName', 'bankAccountNumber', 'bankIfsc', 'bankBranch', 'upiId', 'paymentInstructions', 'signatoryLabel'];

export default function BusinessSettings() {
  const [form, setForm] = useState<Form | null>(null);
  const [configured, setConfigured] = useState(true);
  const [seqs, setSeqs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [seqMsg, setSeqMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([apiJson<{ data: any }>('/api/billing/business'), apiJson<{ data: any[] }>('/api/billing/sequences')])
      .then(([b, s]) => {
        const { configured: c, ...rest } = b.data;
        setConfigured(c);
        setForm(Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? ''])));
        setSeqs(s.data);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (!form) return error ? <p role="alert" className="text-sm text-[#991B1B]">{error}</p> : <p className="text-sm text-[#80909D]">Loading…</p>;

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f!, [k]: v }));
  const text = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={labelCls}>
      {label}
      <input className={`${inputCls} mt-1`} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...props} />
    </label>
  );
  const area = (k: string, label: string, rows = 3) => (
    <label className={`${labelCls} md:col-span-2`}>
      {label}
      <textarea className={`${inputCls} mt-1`} rows={rows} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    const body: Form = {
      displayName: form.displayName,
      gstEnabled: !!form.gstEnabled,
      roundTotal: !!form.roundTotal,
      defaultTaxRate: Number(form.defaultTaxRate),
      quotationValidityDays: Number(form.quotationValidityDays),
      invoiceDueDays: Number(form.invoiceDueDays),
    };
    for (const k of TEXT_FIELDS) body[k] = form[k] ?? '';
    try {
      const r = await apiJson<{ data: any }>('/api/billing/business', { method: 'PUT', json: body });
      setConfigured(r.data.configured);
      setMessage('Business details saved. New quotations and invoices use them; documents already sent or issued keep the details they were created with.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveSeq = async (s: any) => {
    setSeqMsg((m) => ({ ...m, [s.kind]: '' }));
    try {
      const r = await apiJson<{ data: any[] }>('/api/billing/sequences', { method: 'PUT', json: { kind: s.kind, prefix: s.prefix, padding: Number(s.padding), yearMode: s.yearMode, nextNumber: Number(s.nextNumber) } });
      setSeqs(r.data);
      setSeqMsg((m) => ({ ...m, [s.kind]: 'Saved' }));
    } catch (err) {
      setSeqMsg((m) => ({ ...m, [s.kind]: errorMessage(err) }));
    }
  };
  const setSeq = (kind: string, patch: Record<string, unknown>) => setSeqs((ss) => ss.map((s) => (s.kind === kind ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-5 max-w-4xl">
      {!configured && (
        <p className="text-xs bg-[#FFF7E0] border border-[#F0D58C] text-[#6B5413] rounded-lg px-3 py-2">
          Nothing has been entered yet. Add your real address, contact details, GSTIN and bank details below — they are printed on every quotation, invoice and receipt, and nothing is filled in for you.
        </p>
      )}
      {error && <p role="alert" className="text-sm bg-[#FDF2F2] border border-[#F8C4C4] text-[#991B1B] rounded-lg px-3 py-2">{error}</p>}
      {message && <p role="status" className="text-sm bg-[#F6EBC8] border border-[#D4AF37] text-[#6B5413] rounded-lg px-3 py-2">{message}</p>}

      <form onSubmit={save} className="space-y-5">
        <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 space-y-4">
          <div className="flex items-center gap-4">
            <BrandMark size={64} />
            <p className="text-xs text-[#586570]">The official Bharath Interior Decor logo is printed on every document. It is part of the application and is not edited here.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {text('displayName', 'Business name *', { required: true, maxLength: 150 })}
            {text('legalName', 'Legal / registered name', { maxLength: 200 })}
            {area('address', 'Address', 2)}
            {text('city', 'City')}
            {text('state', 'State (decides CGST/SGST vs IGST)')}
            {text('pincode', 'PIN code')}
            {text('phone', 'Phone', { type: 'tel' })}
            {text('email', 'Email', { type: 'email' })}
            {text('website', 'Website')}
            {text('signatoryLabel', 'Signatory label (printed under the signature line)', { placeholder: 'Authorised signatory' })}
          </div>
        </section>

        <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#0B1320]">Tax</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={!!form.gstEnabled} onChange={(e) => set('gstEnabled', e.target.checked)} />
            <span>
              <strong>Charge GST on documents</strong>
              <span className="block text-xs text-[#586570]">Turn on only if the business is registered for GST. While off, every quotation and invoice is a plain non-GST document. A GST invoice cannot be issued without a GSTIN below.</span>
            </span>
          </label>
          <div className="grid md:grid-cols-3 gap-3">
            {text('gstin', 'GSTIN', { maxLength: 15, className: `${inputCls} mt-1 uppercase` })}
            {text('pan', 'PAN', { maxLength: 10, className: `${inputCls} mt-1 uppercase` })}
            <label className={labelCls}>Default GST rate (%)<input className={`${inputCls} mt-1`} type="number" step="0.01" min="0" max="100" value={form.defaultTaxRate} onChange={(e) => set('defaultTaxRate', e.target.value)} /></label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={!!form.roundTotal} onChange={(e) => set('roundTotal', e.target.checked)} />
            <span>Round the grand total to the nearest rupee (the round-off is shown separately)</span>
          </label>
        </section>

        <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 grid md:grid-cols-2 gap-3">
          <h2 className="text-sm font-bold text-[#0B1320] md:col-span-2">Defaults for new documents</h2>
          <label className={labelCls}>Quotation validity (days)<input className={`${inputCls} mt-1`} type="number" min="1" max="365" value={form.quotationValidityDays} onChange={(e) => set('quotationValidityDays', e.target.value)} /></label>
          <label className={labelCls}>Invoice due after (days)<input className={`${inputCls} mt-1`} type="number" min="0" max="365" value={form.invoiceDueDays} onChange={(e) => set('invoiceDueDays', e.target.value)} /></label>
          <div className="md:col-span-2">{text('defaultPaymentTerms', 'Default payment terms')}</div>
          {area('quotationNotes', 'Quotation notes', 2)}
          {area('quotationTerms', 'Quotation terms and conditions', 4)}
          {area('invoiceNotes', 'Invoice notes', 2)}
          {area('invoiceTerms', 'Invoice terms and conditions', 4)}
        </section>

        <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 grid md:grid-cols-2 gap-3">
          <h2 className="text-sm font-bold text-[#0B1320] md:col-span-2">Bank and payment details (printed on invoices)</h2>
          {text('bankAccountName', 'Account name')}
          {text('bankName', 'Bank')}
          {text('bankAccountNumber', 'Account number')}
          {text('bankIfsc', 'IFSC', { maxLength: 11, className: `${inputCls} mt-1 uppercase` })}
          {text('bankBranch', 'Branch')}
          {text('upiId', 'UPI ID')}
          {area('paymentInstructions', 'Other payment instructions', 2)}
        </section>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save business details'}</Button>
        </div>
      </form>

      <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5">
        <h2 className="text-sm font-bold text-[#0B1320]">Document numbering</h2>
        <p className="text-xs text-[#586570] mt-1 mb-3">Number = prefix + optional year + counter. Numbers already used are skipped, so changing the next number never creates a duplicate.</p>
        <div className="space-y-4">
          {seqs.map((s) => (
            <div key={s.kind} className="border border-[#E2E7EC] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold capitalize">{s.kind.toLowerCase()} numbers</p>
                <p className="text-xs text-[#586570]">Next: <strong className="font-mono text-[#0B1320]">{s.preview}</strong></p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <label className={labelCls}>Prefix<input className={`${inputCls} mt-1`} value={s.prefix} onChange={(e) => setSeq(s.kind, { prefix: e.target.value })} maxLength={20} /></label>
                <label className={labelCls}>Digits<input className={`${inputCls} mt-1`} type="number" min="1" max="10" value={s.padding} onChange={(e) => setSeq(s.kind, { padding: e.target.value })} /></label>
                <label className={labelCls}>Year in number
                  <select className={`${inputCls} mt-1`} value={s.yearMode} onChange={(e) => setSeq(s.kind, { yearMode: e.target.value })}>
                    <option value="NONE">None</option>
                    <option value="CALENDAR">Calendar year (2026)</option>
                    <option value="FISCAL">Financial year (2026-27)</option>
                  </select>
                </label>
                <label className={labelCls}>Next number<input className={`${inputCls} mt-1`} type="number" min="1" value={s.nextNumber} onChange={(e) => setSeq(s.kind, { nextNumber: e.target.value })} /></label>
                <div className="flex items-end"><Button type="button" variant="secondary" onClick={() => saveSeq(s)}>Save</Button></div>
              </div>
              {seqMsg[s.kind] && <p className="text-xs mt-2 text-[#586570]" role="status">{seqMsg[s.kind]}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
