'use client';

import React from 'react';
import { lineGross, rupeesToPaise, paiseToRupees } from '@/lib/domain/documentCalc';
import { amountInWords } from '@/lib/domain/amountInWords';
import { ACTION_LABELS, fmtDate, fmtDateTime, inr } from './format';

const n = (v: unknown) => Number(v ?? 0);

/** Read-only presentation of a saved quotation or invoice: every figure shown is the stored one. */
export default function DocumentView({ doc }: { doc: any }) {
  const taxed = doc.taxMode !== 'NONE';
  const items = [...doc.items].sort((a: any, b: any) => a.position - b.position);
  return (
    <div className="space-y-5">
      <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 grid md:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#B8962E] font-semibold">Bill to</p>
          <p className="font-bold text-[#0B1320] mt-1">{doc.customerName}</p>
          {doc.customerAddress && <p className="text-[#586570] whitespace-pre-line">{doc.customerAddress}</p>}
          <p className="text-[#586570]">{[doc.customerPhone, doc.customerEmail].filter(Boolean).join(' · ')}</p>
          {doc.customerGstin && <p className="text-[#586570]">GSTIN: {doc.customerGstin}</p>}
          {doc.customerState && <p className="text-[#586570]">State: {doc.customerState}</p>}
        </div>
        <div className="text-[#586570] space-y-0.5">
          <p>Tax: <strong className="text-[#0B1320]">{doc.taxMode === 'NONE' ? 'No GST' : doc.taxMode === 'INTRA' ? 'CGST + SGST' : 'IGST'}</strong></p>
          {doc.paymentTerms && <p>Payment terms: <strong className="text-[#0B1320]">{doc.paymentTerms}</strong></p>}
        </div>
      </section>

      <section className="bg-white border border-[#CBD2D7] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-[#000000] text-[#D4AF37]">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3 text-right">Qty</th>
                <th className="py-2.5 px-3 text-right">Rate</th>
                <th className="py-2.5 px-3 text-right">Discount</th>
                {taxed && <th className="py-2.5 px-3 text-right">GST %</th>}
                <th className="py-2.5 px-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E7EC]">
              {items.map((i: any, idx: number) => (
                <tr key={i.id}>
                  <td className="py-2.5 px-3">{idx + 1}</td>
                  <td className="py-2.5 px-3 max-w-md">
                    <p className="whitespace-pre-line">{i.description}</p>
                    {i.hsn && <p className="text-[11px] text-[#80909D]">HSN/SAC {i.hsn}</p>}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">{n(i.quantity)} {i.unit}</td>
                  <td className="py-2.5 px-3 text-right">{inr(i.rate)}</td>
                  <td className="py-2.5 px-3 text-right">{n(i.discountAmount) > 0 ? (i.discountType === 'PERCENT' ? `${n(i.discountValue)}%` : inr(i.discountAmount)) : '—'}</td>
                  {taxed && <td className="py-2.5 px-3 text-right">{n(i.taxRate)}</td>}
                  <td className="py-2.5 px-3 text-right font-medium">{inr(paiseToRupees(rupeesToPaise(lineGross(n(i.quantity), n(i.rate))) - rupeesToPaise(n(i.discountAmount))))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 md:p-5 grid md:grid-cols-2 gap-4 border-t border-[#E2E7EC]">
          <p className="text-xs text-[#586570] self-end">{amountInWords(n(doc.grandTotal))}</p>
          <dl className="text-sm space-y-1">
            <Line k="Subtotal" v={inr(doc.subtotal)} />
            {n(doc.discountAmount) > 0 && <Line k="Discount" v={`− ${inr(doc.discountAmount)}`} />}
            {n(doc.shippingCharge) > 0 && <Line k="Shipping" v={inr(doc.shippingCharge)} />}
            {n(doc.otherCharges) > 0 && <Line k="Other charges" v={inr(doc.otherCharges)} />}
            {taxed && <Line k="Taxable value" v={inr(doc.taxableAmount)} />}
            {doc.taxMode === 'INTRA' && (
              <>
                <Line k="CGST" v={inr(doc.cgstAmount)} />
                <Line k="SGST" v={inr(doc.sgstAmount)} />
              </>
            )}
            {doc.taxMode === 'INTER' && <Line k="IGST" v={inr(doc.igstAmount)} />}
            {n(doc.roundOff) !== 0 && <Line k="Round off" v={`${n(doc.roundOff) < 0 ? '− ' : ''}${inr(Math.abs(n(doc.roundOff)))}`} />}
            <div className="flex justify-between border-t border-[#CBD2D7] pt-2 mt-1 text-base font-bold text-[#0B1320]">
              <dt>Grand total</dt>
              <dd>{inr(doc.grandTotal)}</dd>
            </div>
            {doc.amountPaid !== undefined && (
              <>
                <Line k="Amount paid" v={inr(doc.amountPaid)} />
                <div className="flex justify-between font-bold text-[#0B1320]">
                  <dt>Balance due</dt>
                  <dd>{inr(doc.outstanding)}</dd>
                </div>
              </>
            )}
          </dl>
        </div>
      </section>

      {(doc.notes || doc.terms) && (
        <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5 grid gap-3 text-sm">
          {doc.notes && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#B8962E] font-semibold">Notes</p>
              <p className="whitespace-pre-line text-[#0B1320]">{doc.notes}</p>
            </div>
          )}
          {doc.terms && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#B8962E] font-semibold">Terms and conditions</p>
              <p className="whitespace-pre-line text-[#0B1320]">{doc.terms}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[#586570]">
      <dt>{k}</dt>
      <dd className="text-[#0B1320]">{v}</dd>
    </div>
  );
}

/** Audit trail of a document: who did what, when, with the key figures. */
export function HistoryList({ history }: { history: any[] }) {
  if (!history?.length) return null;
  return (
    <section className="bg-white border border-[#CBD2D7] rounded-xl p-4 md:p-5">
      <h2 className="text-sm font-bold text-[#0B1320] mb-3">History</h2>
      <ol className="space-y-2.5 text-xs">
        {history.map((h) => {
          const detail = h.newValue?.reason ?? h.newValue?.rejectionReason ?? null;
          const total = h.newValue?.grandTotal ?? h.newValue?.amount;
          return (
            <li key={h.id} className="flex gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] mt-1.5 shrink-0" />
              <div>
                <p className="text-[#0B1320]">
                  <strong>{ACTION_LABELS[h.action] ?? h.action.replace(/_/g, ' ').toLowerCase()}</strong>
                  {typeof total === 'number' && <span className="text-[#586570]"> · {inr(total)}</span>}
                  {h.newValue?.receiptNumber && <span className="text-[#586570]"> · {h.newValue.receiptNumber}</span>}
                </p>
                {detail && <p className="text-[#586570]">“{detail}”</p>}
                <p className="text-[#80909D]">{fmtDateTime(h.createdAt)}{h.user?.name ? ` · ${h.user.name}` : ''}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { fmtDate };
