'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Trash2, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { apiJson, errorMessage } from '@/lib/client/apiFetch';
import { calculateDocument, resolveTaxMode, type TaxMode } from '@/lib/domain/documentCalc';
import { amountInWords } from '@/lib/domain/amountInWords';
import { addDaysYmd, inr, todayYmd } from './format';

export type DocKind = 'quotation' | 'invoice';

interface Line {
  key: string;
  productId?: string;
  description: string;
  hsn: string;
  quantity: string;
  unit: string;
  rate: string;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: string;
  taxRate: string;
}

interface Profile {
  displayName: string;
  state?: string | null;
  gstEnabled: boolean;
  defaultTaxRate: number;
  roundTotal: boolean;
  quotationValidityDays: number;
  invoiceDueDays: number;
  defaultPaymentTerms?: string | null;
  quotationNotes?: string | null;
  quotationTerms?: string | null;
  invoiceNotes?: string | null;
  invoiceTerms?: string | null;
  configured: boolean;
}

const inputCls = 'w-full px-3 py-2 bg-white border border-[#CBD2D7] rounded-lg text-sm focus:ring-1 focus:ring-[#000000] focus:outline-none';
const labelCls = 'block text-xs font-semibold text-[#0B1320]';
const num = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? 0 : Number(s));
const newKey = () => Math.random().toString(36).slice(2);
const blankLine = (taxRate: number): Line => ({ key: newKey(), description: '', hsn: '', quantity: '1', unit: 'PCS', rate: '', discountType: 'PERCENT', discountValue: '0', taxRate: String(taxRate) });

export default function DocumentEditor({ kind, initial }: { kind: DocKind; initial?: any }) {
  const router = useRouter();
  const isQuote = kind === 'quotation';
  const editing = !!initial;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [customer, setCustomer] = useState({
    clientId: initial?.clientId ?? '',
    name: initial?.customerName ?? '',
    phone: initial?.customerPhone ?? '',
    email: initial?.customerEmail ?? '',
    address: initial?.customerAddress ?? '',
    gstin: initial?.customerGstin ?? '',
    state: initial?.customerState ?? '',
  });
  const [date, setDate] = useState<string>(initial ? (isQuote ? initial.quotationDate : initial.invoiceDate).slice(0, 10) : todayYmd());
  const [secondDate, setSecondDate] = useState<string>(initial ? (isQuote ? initial.validUntil : initial.dueDate).slice(0, 10) : '');
  const [secondTouched, setSecondTouched] = useState(editing);
  const [taxModeChoice, setTaxModeChoice] = useState<'AUTO' | TaxMode>(initial ? (initial.taxMode as TaxMode) : 'AUTO');
  const [lines, setLines] = useState<Line[]>(
    initial
      ? [...initial.items]
          .sort((a: any, b: any) => a.position - b.position)
          .map((i: any) => ({
            key: newKey(),
            productId: i.productId ?? undefined,
            description: i.description,
            hsn: i.hsn ?? '',
            quantity: String(Number(i.quantity)),
            unit: i.unit,
            rate: String(Number(i.rate)),
            discountType: i.discountType,
            discountValue: String(Number(i.discountValue)),
            taxRate: String(Number(i.taxRate)),
          }))
      : []
  );
  const [discountType, setDiscountType] = useState<'PERCENT' | 'AMOUNT'>(initial?.discountType ?? 'AMOUNT');
  const [discountValue, setDiscountValue] = useState(String(Number(initial?.discountValue ?? 0)));
  const [shipping, setShipping] = useState(String(Number(initial?.shippingCharge ?? 0)));
  const [other, setOther] = useState(String(Number(initial?.otherCharges ?? 0)));
  const [chargesTaxRate, setChargesTaxRate] = useState<string>(initial ? String(Number(initial.chargesTaxRate)) : '');
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [terms, setTerms] = useState(initial?.terms ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Business settings: GST on/off, default rate, validity/due days and default text for new documents.
  useEffect(() => {
    apiJson<{ data: Profile }>('/api/billing/business')
      .then(({ data }) => {
        setProfile(data);
        if (!editing) {
          setLines([blankLine(data.defaultTaxRate)]);
          setPaymentTerms(data.defaultPaymentTerms ?? '');
          setNotes((isQuote ? data.quotationNotes : data.invoiceNotes) ?? '');
          setTerms((isQuote ? data.quotationTerms : data.invoiceTerms) ?? '');
        }
      })
      .catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!profile || secondTouched) return;
    setSecondDate(addDaysYmd(date, isQuote ? profile.quotationValidityDays : profile.invoiceDueDays));
  }, [profile, date, secondTouched, isQuote]);

  const gst = profile?.gstEnabled ?? false;
  const effectiveMode: TaxMode = !gst ? 'NONE' : taxModeChoice === 'AUTO' ? resolveTaxMode({ gstEnabled: true, businessState: profile?.state, customerState: customer.state }) : taxModeChoice;
  const chargeRate = chargesTaxRate.trim() === '' ? profile?.defaultTaxRate ?? 0 : num(chargesTaxRate);

  const calc = useMemo(
    () =>
      calculateDocument({
        taxMode: effectiveMode,
        roundTotal: profile?.roundTotal ?? true,
        discountType,
        discountValue: num(discountValue),
        shippingCharge: num(shipping),
        otherCharges: num(other),
        chargesTaxRate: chargeRate,
        lines: lines.map((l) => ({ quantity: num(l.quantity), rate: num(l.rate), discountType: l.discountType, discountValue: num(l.discountValue), taxRate: num(l.taxRate) })),
      }),
    [effectiveMode, profile?.roundTotal, discountType, discountValue, shipping, other, chargeRate, lines]
  );

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // --- Customer search ---
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<any[]>([]);
  const clientTimer = useRef<ReturnType<typeof setTimeout>>();
  const searchClients = (q: string) => {
    setClientQuery(q);
    clearTimeout(clientTimer.current);
    if (q.trim().length < 2) return setClientResults([]);
    clientTimer.current = setTimeout(() => {
      apiJson<{ data: any[] }>(`/api/clients?search=${encodeURIComponent(q.trim())}&limit=8`).then((r) => setClientResults(r.data ?? [])).catch(() => setClientResults([]));
    }, 250);
  };
  const pickClient = (c: any) => {
    setCustomer({
      clientId: c.id,
      name: c.businessName || c.name,
      phone: c.phone ?? '',
      email: c.email ?? '',
      address: [c.address, c.city, c.pincode].filter(Boolean).join(', '),
      gstin: c.gstNumber ?? '',
      state: c.state ?? '',
    });
    setClientQuery('');
    setClientResults([]);
  };

  // --- Product search ---
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const productTimer = useRef<ReturnType<typeof setTimeout>>();
  const searchProducts = (q: string) => {
    setProductQuery(q);
    clearTimeout(productTimer.current);
    if (q.trim().length < 2) return setProductResults([]);
    productTimer.current = setTimeout(() => {
      apiJson<{ data: any[] }>(`/api/products?search=${encodeURIComponent(q.trim())}&limit=8`).then((r) => setProductResults(r.data ?? [])).catch(() => setProductResults([]));
    }, 250);
  };
  const addProduct = (p: any) => {
    const line: Line = { key: newKey(), productId: p.id, description: p.name, hsn: '', quantity: '1', unit: p.unit || 'PCS', rate: String(Number(p.sellingPrice)), discountType: 'PERCENT', discountValue: '0', taxRate: String(Number(p.taxRate ?? profile?.defaultTaxRate ?? 0)) };
    setLines((ls) => (ls.length === 1 && !ls[0].description && !ls[0].rate ? [line] : [...ls, line]));
    setProductQuery('');
    setProductResults([]);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const body: Record<string, unknown> = {
      clientId: customer.clientId || undefined,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      customerAddress: customer.address,
      customerGstin: customer.gstin,
      customerState: customer.state,
      [isQuote ? 'quotationDate' : 'invoiceDate']: date,
      [isQuote ? 'validUntil' : 'dueDate']: secondDate || undefined,
      taxMode: gst ? effectiveMode : undefined,
      discountType,
      discountValue: num(discountValue),
      shippingCharge: num(shipping),
      otherCharges: num(other),
      chargesTaxRate: gst && effectiveMode !== 'NONE' ? chargeRate : undefined,
      paymentTerms,
      notes,
      terms,
      lines: lines.map((l) => ({
        productId: l.productId,
        description: l.description,
        hsn: l.hsn,
        quantity: num(l.quantity),
        unit: l.unit,
        rate: num(l.rate),
        discountType: l.discountType,
        discountValue: num(l.discountValue),
        taxRate: effectiveMode === 'NONE' ? undefined : num(l.taxRate),
      })),
    };
    try {
      const path = isQuote ? '/api/quotations' : '/api/invoices';
      const res = await apiJson<{ data: { id: string } }>(editing ? `${path}/${initial.id}` : path, { method: editing ? 'PUT' : 'POST', json: body });
      router.push(`${path.replace('/api', '')}/${res.data.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const showTax = effectiveMode !== 'NONE';
  const title = isQuote ? 'quotation' : 'invoice';

  return (
    <form onSubmit={save} className="space-y-5 max-w-5xl">
      {profile && !profile.configured && (
        <p className="text-xs bg-[#FFF7E0] border border-[#F0D58C] text-[#6B5413] rounded-lg px-3 py-2">
          Business details are not set up yet. Documents will print only the business name until they are added in Settings → Business details.
        </p>
      )}
      {!gst && profile && (
        <p className="text-xs bg-[#F3F5F6] border border-[#CBD2D7] text-[#586570] rounded-lg px-3 py-2">
          GST is switched off in Settings, so this {title} is a non-GST document (no tax is charged).
        </p>
      )}
      {error && <div role="alert" className="text-sm bg-[#FDF2F2] border border-[#F8C4C4] text-[#991B1B] rounded-lg px-3 py-2">{error}</div>}

      {/* Customer */}
      <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 space-y-3">
        <h2 className="text-sm font-bold text-[#0B1320]">Customer</h2>
        <div className="relative">
          <label className={labelCls}>
            Find an existing client (optional)
            <span className="relative block mt-1">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#80909D]" />
              <input className={`${inputCls} pl-9`} value={clientQuery} onChange={(e) => searchClients(e.target.value)} placeholder="Search clients by name, phone or city" />
            </span>
          </label>
          {clientResults.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full bg-white border border-[#CBD2D7] rounded-lg shadow-lg max-h-64 overflow-auto">
              {clientResults.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => pickClient(c)} className="w-full text-left px-3 py-2 hover:bg-[#F3F5F6] text-sm">
                    <span className="font-medium">{c.businessName || c.name}</span>
                    <span className="block text-xs text-[#586570]">{[c.phone, c.city].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {customer.clientId && (
          <p className="text-xs text-[#586570]">
            Linked to a client record.{' '}
            <button type="button" className="underline" onClick={() => setCustomer((c) => ({ ...c, clientId: '' }))}>Unlink</button>
          </p>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <label className={labelCls}>Customer name *<input className={`${inputCls} mt-1`} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} required maxLength={200} /></label>
          <label className={labelCls}>Phone<input className={`${inputCls} mt-1`} type="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} maxLength={30} /></label>
          <label className={labelCls}>Email<input className={`${inputCls} mt-1`} type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} maxLength={200} /></label>
          <label className={labelCls}>GSTIN (if registered)<input className={`${inputCls} mt-1 uppercase`} value={customer.gstin} onChange={(e) => setCustomer({ ...customer, gstin: e.target.value })} maxLength={15} /></label>
          <label className={`${labelCls} md:col-span-2`}>Billing address<textarea className={`${inputCls} mt-1`} rows={2} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} maxLength={500} /></label>
          <label className={labelCls}>State (decides CGST/SGST or IGST)<input className={`${inputCls} mt-1`} value={customer.state} onChange={(e) => setCustomer({ ...customer, state: e.target.value })} maxLength={80} /></label>
        </div>
      </section>

      {/* Dates and tax */}
      <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 grid md:grid-cols-3 gap-3">
        <label className={labelCls}>{isQuote ? 'Quotation date' : 'Invoice date'}<input className={`${inputCls} mt-1`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className={labelCls}>{isQuote ? 'Valid until' : 'Payment due date'}<input className={`${inputCls} mt-1`} type="date" min={date} value={secondDate} onChange={(e) => { setSecondDate(e.target.value); setSecondTouched(true); }} required /></label>
        {gst && (
          <label className={labelCls}>
            Tax
            <select className={`${inputCls} mt-1`} value={taxModeChoice} onChange={(e) => setTaxModeChoice(e.target.value as 'AUTO' | TaxMode)}>
              <option value="AUTO">Automatic ({effectiveMode === 'INTER' ? 'IGST' : 'CGST + SGST'} by state)</option>
              <option value="INTRA">CGST + SGST (same state)</option>
              <option value="INTER">IGST (other state)</option>
              <option value="NONE">No GST on this document</option>
            </select>
          </label>
        )}
      </section>

      {/* Items */}
      <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-bold text-[#0B1320]">Items</h2>
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#80909D]" />
            <input className={`${inputCls} pl-9`} value={productQuery} onChange={(e) => searchProducts(e.target.value)} placeholder="Add from product catalogue…" aria-label="Search products" />
            {productResults.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full bg-white border border-[#CBD2D7] rounded-lg shadow-lg max-h-64 overflow-auto">
                {productResults.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 hover:bg-[#F3F5F6] text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-[#586570]">{p.sku} · {inr(p.sellingPrice)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {lines.map((l, i) => {
            const r = calc.lines[i];
            return (
              <div key={l.key} className="border border-[#E2E7EC] rounded-lg p-3 bg-[#FBFBFA]">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-[#80909D] pt-2 w-5">{i + 1}</span>
                  <textarea className={`${inputCls} flex-1`} rows={2} placeholder="Item or service description *" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} required maxLength={500} aria-label={`Item ${i + 1} description`} />
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1} aria-label={`Remove item ${i + 1}`} className="p-2 text-[#991B1B] disabled:opacity-30">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-12 gap-2 mt-2 text-xs">
                  <label className={`${labelCls} md:col-span-2`}>HSN/SAC<input className={`${inputCls} mt-1`} value={l.hsn} onChange={(e) => setLine(l.key, { hsn: e.target.value })} maxLength={16} /></label>
                  <label className={`${labelCls} md:col-span-2`}>Qty<input className={`${inputCls} mt-1`} type="number" inputMode="decimal" step="any" min="0" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} required /></label>
                  <label className={`${labelCls} md:col-span-1`}>Unit<input className={`${inputCls} mt-1`} value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} maxLength={16} /></label>
                  <label className={`${labelCls} md:col-span-2`}>Rate (₹)<input className={`${inputCls} mt-1`} type="number" inputMode="decimal" step="0.01" min="0" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} required /></label>
                  <label className={`${labelCls} md:col-span-2`}>
                    Discount
                    <span className="flex mt-1">
                      <input className={`${inputCls} rounded-r-none`} type="number" inputMode="decimal" step="0.01" min="0" value={l.discountValue} onChange={(e) => setLine(l.key, { discountValue: e.target.value })} />
                      <select className="border border-l-0 border-[#CBD2D7] rounded-r-lg px-1 text-sm bg-white" value={l.discountType} onChange={(e) => setLine(l.key, { discountType: e.target.value as 'PERCENT' | 'AMOUNT' })} aria-label="Discount type">
                        <option value="PERCENT">%</option>
                        <option value="AMOUNT">₹</option>
                      </select>
                    </span>
                  </label>
                  {showTax && <label className={`${labelCls} md:col-span-1`}>GST %<input className={`${inputCls} mt-1`} type="number" inputMode="decimal" step="0.01" min="0" max="100" value={l.taxRate} onChange={(e) => setLine(l.key, { taxRate: e.target.value })} /></label>}
                  <div className={`col-span-2 ${showTax ? 'md:col-span-2' : 'md:col-span-3'} text-right self-end pb-2`}>
                    <span className="text-[#586570]">Line total </span>
                    <strong className="text-sm text-[#0B1320]">{inr(r?.lineTotal ?? 0)}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <Button type="button" variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setLines((ls) => [...ls, blankLine(profile?.defaultTaxRate ?? 0)])}>
          Add line
        </Button>
      </section>

      {/* Totals */}
      <section className="grid md:grid-cols-2 gap-5">
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#0B1320]">Discount and charges</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className={`${labelCls} col-span-2`}>
              Overall discount
              <span className="flex mt-1">
                <input className={`${inputCls} rounded-r-none`} type="number" inputMode="decimal" step="0.01" min="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                <select className="border border-l-0 border-[#CBD2D7] rounded-r-lg px-2 text-sm bg-white" value={discountType} onChange={(e) => setDiscountType(e.target.value as 'PERCENT' | 'AMOUNT')} aria-label="Overall discount type">
                  <option value="AMOUNT">₹</option>
                  <option value="PERCENT">%</option>
                </select>
              </span>
            </label>
            <label className={labelCls}>Shipping / delivery (₹)<input className={`${inputCls} mt-1`} type="number" inputMode="decimal" step="0.01" min="0" value={shipping} onChange={(e) => setShipping(e.target.value)} /></label>
            <label className={labelCls}>Other charges (₹)<input className={`${inputCls} mt-1`} type="number" inputMode="decimal" step="0.01" min="0" value={other} onChange={(e) => setOther(e.target.value)} /></label>
            {showTax && (
              <label className={`${labelCls} col-span-2`}>GST % on shipping and other charges<input className={`${inputCls} mt-1`} type="number" step="0.01" min="0" max="100" value={chargesTaxRate} placeholder={String(profile?.defaultTaxRate ?? 0)} onChange={(e) => setChargesTaxRate(e.target.value)} /></label>
            )}
          </div>
        </div>
        <div className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5">
          <h2 className="text-sm font-bold text-[#0B1320] mb-3">Summary</h2>
          <dl className="text-sm space-y-1.5">
            <Row k="Subtotal" v={inr(calc.subtotal)} />
            {calc.discountAmount > 0 && <Row k="Discount" v={`− ${inr(calc.discountAmount)}`} />}
            {calc.shippingCharge > 0 && <Row k="Shipping" v={inr(calc.shippingCharge)} />}
            {calc.otherCharges > 0 && <Row k="Other charges" v={inr(calc.otherCharges)} />}
            {showTax && <Row k="Taxable value" v={inr(calc.taxableAmount)} />}
            {effectiveMode === 'INTRA' && (
              <>
                <Row k="CGST" v={inr(calc.cgstAmount)} />
                <Row k="SGST" v={inr(calc.sgstAmount)} />
              </>
            )}
            {effectiveMode === 'INTER' && <Row k="IGST" v={inr(calc.igstAmount)} />}
            {calc.roundOff !== 0 && <Row k="Round off" v={`${calc.roundOff < 0 ? '− ' : ''}${inr(Math.abs(calc.roundOff))}`} />}
            <div className="flex justify-between border-t border-[#CBD2D7] pt-2 mt-2 text-base font-bold text-[#0B1320]">
              <dt>Grand total</dt>
              <dd>{inr(calc.grandTotal)}</dd>
            </div>
          </dl>
          <p className="text-xs text-[#586570] mt-2">{amountInWords(calc.grandTotal)}</p>
          <p className="text-[11px] text-[#80909D] mt-1">Preview only — the saved totals are recalculated by the server when you save.</p>
        </div>
      </section>

      {/* Terms */}
      <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 grid gap-3">
        <label className={labelCls}>Payment terms<input className={`${inputCls} mt-1`} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} maxLength={500} /></label>
        <label className={labelCls}>Notes<textarea className={`${inputCls} mt-1`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
        <label className={labelCls}>Terms and conditions<textarea className={`${inputCls} mt-1`} rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={5000} /></label>
      </section>

      <div className="flex justify-end gap-2 sticky bottom-0 bg-[#F5F7F8]/90 backdrop-blur py-3 -mx-1 px-1">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
        <Button type="submit" disabled={saving || !profile}>{saving ? 'Saving…' : editing ? `Save ${title}` : `Create ${title}`}</Button>
      </div>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[#586570]">
      <dt>{k}</dt>
      <dd className="text-[#0B1320]">{v}</dd>
    </div>
  );
}
