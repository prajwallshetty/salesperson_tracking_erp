import { businessForDocument, type BusinessDetails } from './business';
import { dateToYmd } from './documents';
import { invoiceDisplayStatus, outstandingOf } from './invoices';
import type { PdfDocumentData, PdfLine, PdfReceiptData, PdfTotals } from './pdf';

const n = (v: unknown) => Number(v);

function lines(items: any[]): PdfLine[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      description: i.description,
      hsn: i.hsn,
      quantity: n(i.quantity),
      unit: i.unit,
      rate: n(i.rate),
      discountType: i.discountType,
      discountValue: n(i.discountValue),
      discountAmount: n(i.discountAmount),
      taxableAmount: n(i.taxableAmount),
      taxRate: n(i.taxRate),
      cgstAmount: n(i.cgstAmount),
      sgstAmount: n(i.sgstAmount),
      igstAmount: n(i.igstAmount),
      lineTotal: n(i.lineTotal),
    }));
}

function totals(d: any): PdfTotals {
  return {
    subtotal: n(d.subtotal),
    discountAmount: n(d.discountAmount),
    shippingCharge: n(d.shippingCharge),
    otherCharges: n(d.otherCharges),
    chargesTaxRate: n(d.chargesTaxRate),
    taxableAmount: n(d.taxableAmount),
    cgstAmount: n(d.cgstAmount),
    sgstAmount: n(d.sgstAmount),
    igstAmount: n(d.igstAmount),
    taxAmount: n(d.taxAmount),
    roundOff: n(d.roundOff),
    grandTotal: n(d.grandTotal),
  };
}

const customer = (d: any) => ({ name: d.customerName, address: d.customerAddress, phone: d.customerPhone, email: d.customerEmail, gstin: d.customerGstin, state: d.customerState });

const QUOTE_MARK: Record<string, string> = { DRAFT: 'DRAFT', REVISED: 'SUPERSEDED', EXPIRED: 'EXPIRED', REJECTED: 'REJECTED' };

export function quotationPdfData(q: any, live: BusinessDetails): PdfDocumentData {
  return {
    kind: 'QUOTATION',
    number: q.number,
    revision: q.revision,
    status: q.status,
    watermark: QUOTE_MARK[q.status] ?? null,
    date: dateToYmd(new Date(q.quotationDate)),
    secondDateLabel: 'Valid until',
    secondDate: dateToYmd(new Date(q.validUntil)),
    business: businessForDocument(q.businessSnapshot, live),
    customer: customer(q),
    taxMode: q.taxMode,
    lines: lines(q.items),
    totals: totals(q),
    paymentTerms: q.paymentTerms,
    notes: q.notes,
    terms: q.terms,
  };
}

export function invoicePdfData(inv: any, live: BusinessDetails): PdfDocumentData {
  const status = invoiceDisplayStatus({ status: inv.status, dueDate: new Date(inv.dueDate) });
  return {
    kind: 'INVOICE',
    number: inv.number,
    status,
    watermark: inv.status === 'DRAFT' ? 'DRAFT' : inv.status === 'CANCELLED' ? 'CANCELLED' : null,
    date: dateToYmd(new Date(inv.invoiceDate)),
    secondDateLabel: 'Due date',
    secondDate: dateToYmd(new Date(inv.dueDate)),
    business: businessForDocument(inv.businessSnapshot, live),
    customer: customer(inv),
    taxMode: inv.taxMode,
    lines: lines(inv.items),
    totals: totals(inv),
    paymentTerms: inv.paymentTerms,
    notes: inv.notes,
    terms: inv.terms,
    amountPaid: n(inv.amountPaid),
    outstanding: outstandingOf(inv),
  };
}

export function receiptPdfData(inv: any, payment: any, live: BusinessDetails): PdfReceiptData {
  // Balance right after this payment: invoice total minus the recorded payments made up to and including it.
  const paidThen = (inv.payments as any[])
    .filter((p) => p.status === 'RECORDED' && new Date(p.createdAt) <= new Date(payment.createdAt))
    .reduce((a, p) => a + Math.round(n(p.amount) * 100), 0);
  return {
    receiptNumber: payment.receiptNumber,
    paidOn: dateToYmd(new Date(payment.paidOn)),
    amount: n(payment.amount),
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    voided: payment.status === 'VOIDED',
    business: businessForDocument(inv.businessSnapshot, live),
    customer: { name: inv.customerName, address: inv.customerAddress },
    invoiceNumber: inv.number ?? 'Draft',
    invoiceTotal: n(inv.grandTotal),
    balanceAfter: Math.max(0, Math.round(n(inv.grandTotal) * 100) - paidThen) / 100,
  };
}
