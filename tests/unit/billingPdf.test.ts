import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { renderDocumentPdf, renderReceiptPdf, taxSummary, type PdfDocumentData } from '@/features/billing/pdf';
import { computeDocument, type DocumentDraftInput } from '@/features/billing/documents';
import { DEFAULT_BUSINESS } from '@/features/billing/business';
import { formatDocumentNumber, yearToken } from '@/features/billing/sequences';

const business = { ...DEFAULT_BUSINESS, gstEnabled: true, state: 'Karnataka', gstin: '29ABCDE1234F1Z5', address: '1 Test Street', city: 'Testville', phone: '0000000000' };

function build(lineCount: number, taxMode: 'NONE' | 'INTRA' | 'INTER' = 'INTRA'): { data: PdfDocumentData; draft: DocumentDraftInput } {
  const draft: DocumentDraftInput = {
    customerName: 'Test Customer',
    customerState: 'Karnataka',
    discountType: 'AMOUNT',
    discountValue: 100,
    shippingCharge: 250,
    otherCharges: 0,
    taxMode,
    lines: Array.from({ length: lineCount }, (_, i) => ({
      description: `Item ${i + 1} — a reasonably long description that needs to wrap onto a second line in the table`,
      quantity: 1 + (i % 4),
      unit: 'PCS',
      rate: 1234.5 + i,
      discountType: 'PERCENT' as const,
      discountValue: i % 3 === 0 ? 5 : 0,
      taxRate: i % 2 ? 18 : 12,
    })),
  };
  const c = computeDocument(draft, { ...business, defaultTaxRate: 18, roundTotal: true });
  const data: PdfDocumentData = {
    kind: 'INVOICE',
    number: 'INV-0001',
    status: 'ISSUED',
    date: '2026-10-18',
    secondDateLabel: 'Due date',
    secondDate: '2026-11-02',
    business,
    customer: { name: draft.customerName, state: 'Karnataka' },
    taxMode: c.taxMode,
    lines: c.items.map((i) => ({ ...i, hsn: null })),
    totals: { ...c.header, chargesTaxRate: c.header.chargesTaxRate },
    amountPaid: 0,
    outstanding: c.header.grandTotal,
    paymentTerms: 'Net 15',
  };
  return { data, draft };
}

/** Text drawn on the page, read back from the uncompressed content streams. */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    out.push([...m[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  }
  return out.join('\n');
}
const pageCount = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('document PDFs', () => {
  it('prints the saved totals, amount in words and the tax summary', async () => {
    const { data } = build(3);
    const pdf = await renderDocumentPdf(data, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    expect(text).toContain('TAX INVOICE');
    expect(text).toContain('INV-0001');
    expect(text).toContain('Rs. ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(data.totals.grandTotal));
    expect(text).toContain('Rupees');
    expect(text).toContain('Only');
    expect(text).toContain('TAX SUMMARY');
    expect(text).toContain('Bharath Interior Decor');
    expect(text).toContain('29ABCDE1234F1Z5');
    expect(text).toContain('CGST');
  });

  it('paginates long documents and numbers every page', async () => {
    const { data } = build(60);
    const pdf = await renderDocumentPdf(data, { compress: false });
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(1);
    const text = pdfText(pdf);
    for (let p = 1; p <= pages; p++) expect(text).toContain(`Page ${p} of ${pages}`);
    // Every one of the 60 lines is on some page.
    for (const n of [1, 30, 60]) expect(text).toContain(`Item ${n} `);
  });

  it('prints a non-GST document without tax columns', async () => {
    const { data } = build(2, 'NONE');
    const text = pdfText(await renderDocumentPdf(data, { compress: false }));
    expect(text).toContain('INVOICE');
    expect(text).not.toContain('TAX INVOICE');
    expect(text).not.toContain('TAX SUMMARY');
    expect(text).not.toContain('CGST');
  });

  it('marks drafts and cancelled invoices with a watermark', async () => {
    const { data } = build(1);
    const text = pdfText(await renderDocumentPdf({ ...data, watermark: 'CANCELLED' }, { compress: false }));
    expect(text).toContain('CANCELLED');
  });

  it('renders a receipt with the balance after the payment', async () => {
    const pdf = await renderReceiptPdf(
      { receiptNumber: 'RCT-0001', paidOn: '2026-10-18', amount: 500, method: 'UPI', reference: 'UTR123', voided: false, business, customer: { name: 'Test Customer' }, invoiceNumber: 'INV-0001', invoiceTotal: 1500, balanceAfter: 1000 },
      { compress: false }
    );
    const text = pdfText(pdf);
    expect(text).toContain('RCT-0001');
    expect(text).toContain('Rs. 500.00');
    expect(text).toContain('Rs. 1,000.00');
    expect(text).toContain('Rupees Five Hundred Only');
    expect(text).toContain('UTR123');
  });

  it('can write a sample to disk for visual inspection', async () => {
    const dir = process.env.PDF_SAMPLE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'invoice-gst.pdf'), await renderDocumentPdf(build(8).data));
    writeFileSync(path.join(dir, 'invoice-long.pdf'), await renderDocumentPdf(build(45).data));
    const q = build(4, 'INTER').data;
    writeFileSync(path.join(dir, 'quotation-igst.pdf'), await renderDocumentPdf({ ...q, kind: 'QUOTATION', number: 'QT-0007', revision: 2, status: 'SENT', secondDateLabel: 'Valid until', watermark: null, notes: 'Delivery within 10 working days of confirmation.', terms: '1. Prices are valid until the date above.\n2. Goods once sold are not returnable.' }));
  });
});

describe('tax summary', () => {
  it('groups saved lines and charges by rate and adds up to the saved totals', () => {
    const { data } = build(9);
    const rows = taxSummary(data.lines, data.totals);
    const cgst = Math.round(rows.reduce((a, r) => a + r.cgst * 100, 0));
    const taxable = Math.round(rows.reduce((a, r) => a + r.taxable * 100, 0));
    expect(cgst).toBe(Math.round(data.totals.cgstAmount * 100));
    expect(taxable).toBe(Math.round(data.totals.taxableAmount * 100));
  });
});

describe('document numbering format', () => {
  it('formats prefix, optional year and padded counter', () => {
    expect(formatDocumentNumber({ prefix: 'INV-', padding: 4 }, null, 7)).toBe('INV-0007');
    expect(formatDocumentNumber({ prefix: 'QT/', padding: 3 }, '2026-27', 12)).toBe('QT/2026-27-012');
  });
  it('derives the calendar and Indian financial year tokens', () => {
    expect(yearToken('NONE', '2026-10-18')).toBeNull();
    expect(yearToken('CALENDAR', '2026-10-18')).toBe('2026');
    expect(yearToken('FISCAL', '2026-10-18')).toBe('2026-27');
    expect(yearToken('FISCAL', '2027-03-31')).toBe('2026-27');
    expect(yearToken('FISCAL', '2027-04-01')).toBe('2027-28');
  });
});
