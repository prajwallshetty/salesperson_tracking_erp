import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { amountInWords } from '@/lib/domain/amountInWords';
import { lineGross, paiseToRupees, rupeesToPaise } from '@/lib/domain/documentCalc';
import type { BusinessDetails } from './business';

/**
 * Quotation, invoice and receipt PDFs. They are rendered only from the saved document (the same
 * numbers the API returns), never from recomputed values, so the PDF always matches the record.
 *
 * Amounts are written "Rs." because the built-in PDF fonts have no rupee sign. Standard Latin text
 * only: names or addresses in other scripts need an embedded font.
 */

const BLACK = '#000000';
const GOLD = '#B8962E';
const GOLD_LIGHT = '#D4AF37';
const SILVER = '#C0C0C0';
const INK = '#111111';
const MUTED = '#5B5B5B';
const ZEBRA = '#F6F4EE';
const MARGIN = 40;

export interface PdfLine {
  description: string;
  hsn?: string | null;
  quantity: number;
  unit: string;
  rate: number;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: number;
  discountAmount: number;
  taxableAmount: number;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineTotal: number;
}

export interface PdfTotals {
  subtotal: number;
  discountAmount: number;
  shippingCharge: number;
  otherCharges: number;
  chargesTaxRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  roundOff: number;
  grandTotal: number;
}

export interface PdfDocumentData {
  kind: 'QUOTATION' | 'INVOICE';
  number: string | null;
  revision?: number;
  status: string;
  /** e.g. "DRAFT", "CANCELLED": printed as a diagonal watermark. */
  watermark?: string | null;
  date: string;
  secondDateLabel: string;
  secondDate: string;
  business: BusinessDetails;
  customer: { name: string; address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null; state?: string | null };
  taxMode: 'NONE' | 'INTRA' | 'INTER';
  lines: PdfLine[];
  totals: PdfTotals;
  paymentTerms?: string | null;
  notes?: string | null;
  terms?: string | null;
  amountPaid?: number;
  outstanding?: number;
  reference?: string | null;
}

export interface PdfReceiptData {
  receiptNumber: string;
  paidOn: string;
  amount: number;
  method: string;
  reference?: string | null;
  notes?: string | null;
  voided: boolean;
  business: BusinessDetails;
  customer: { name: string; address?: string | null };
  invoiceNumber: string;
  invoiceTotal: number;
  balanceAfter: number;
}

let logoCache: Buffer | null | undefined;
function logo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = readFileSync(path.join(process.cwd(), 'public', 'brand', 'logo-512.png'));
  } catch {
    logoCache = null; // the document is still issued, with the name only
  }
  return logoCache;
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `Rs. ${inr.format(n)}`;
const num = (n: number) => inr.format(n);
const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));
const ymdLabel = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const METHOD: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', CARD: 'Card', OTHER: 'Other' };
export const paymentMethodLabel = (m: string) => METHOD[m] ?? m;

/** Tax summary rows built from the saved lines and charges (no recalculation of tax). */
export function taxSummary(lines: PdfLine[], t: PdfTotals) {
  const slabs = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  const add = (rate: number, taxable: number, cgst: number, sgst: number, igst: number) => {
    const s = slabs.get(rate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    s.taxable += rupeesToPaise(taxable);
    s.cgst += rupeesToPaise(cgst);
    s.sgst += rupeesToPaise(sgst);
    s.igst += rupeesToPaise(igst);
    slabs.set(rate, s);
  };
  for (const l of lines) add(l.taxRate, l.taxableAmount, l.cgstAmount, l.sgstAmount, l.igstAmount);
  const charges = t.shippingCharge + t.otherCharges;
  if (charges > 0) {
    const sum = (k: 'cgstAmount' | 'sgstAmount' | 'igstAmount') => lines.reduce((a, l) => a + rupeesToPaise(l[k]), 0);
    add(t.chargesTaxRate, charges, paiseToRupees(rupeesToPaise(t.cgstAmount) - sum('cgstAmount')), paiseToRupees(rupeesToPaise(t.sgstAmount) - sum('sgstAmount')), paiseToRupees(rupeesToPaise(t.igstAmount) - sum('igstAmount')));
  }
  return [...slabs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, s]) => ({ rate, taxable: paiseToRupees(s.taxable), cgst: paiseToRupees(s.cgst), sgst: paiseToRupees(s.sgst), igst: paiseToRupees(s.igst) }));
}

export interface PdfOptions {
  /** Content-stream compression; tests switch it off to read the text back. */
  compress?: boolean;
}

function renderTo(build: (doc: PDFKit.PDFDocument) => void, meta: { title: string; footerLeft: string }, opts: PdfOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, compress: opts.compress !== false, info: { Title: meta.title, Author: 'Bharath Interior Decor' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    // Page numbers once the total is known.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const y = doc.page.height - 30;
      doc.save();
      doc.page.margins.bottom = 0; // allow writing inside the bottom margin without adding a page
      doc.fontSize(8).fillColor(MUTED).font('Helvetica');
      doc.text(meta.footerLeft, MARGIN, y, { width: 330, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, doc.page.width - MARGIN - 120, y, { width: 120, align: 'right', lineBreak: false });
      doc.restore();
    }
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, business: BusinessDetails, title: string, subtitle?: string) {
  const w = doc.page.width;
  doc.rect(0, 0, w, 96).fill(BLACK);
  doc.rect(0, 96, w, 3).fill(GOLD_LIGHT);
  const img = logo();
  let x = MARGIN;
  if (img) {
    doc.image(img, MARGIN, 14, { width: 68, height: 68 });
    x = MARGIN + 82;
  }
  doc.font('Helvetica-Bold').fontSize(17).fillColor(GOLD_LIGHT).text(business.displayName, x, 20, { width: 300 });
  const detail = [business.legalName && business.legalName !== business.displayName ? business.legalName : null, [business.address, business.city, business.state, business.pincode].filter(Boolean).join(', '), [business.phone && `Ph: ${business.phone}`, business.email].filter(Boolean).join('   '), business.gstin ? `GSTIN: ${business.gstin}` : null]
    .filter(Boolean)
    .join('\n');
  doc.font('Helvetica').fontSize(8).fillColor(SILVER).text(detail, x, 42, { width: 300, lineGap: 1 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#FFFFFF').text(title, w - MARGIN - 190, 22, { width: 190, align: 'right' });
  if (subtitle) doc.font('Helvetica').fontSize(9).fillColor(SILVER).text(subtitle, w - MARGIN - 190, 50, { width: 190, align: 'right' });
  doc.y = 116;
}

function watermark(doc: PDFKit.PDFDocument, text: string) {
  const cursorY = doc.y;
  doc.save();
  doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font('Helvetica-Bold').fontSize(text.length > 8 ? 72 : text.length > 5 ? 90 : 110).fillColor('#000000').fillOpacity(0.06);
  doc.text(text, 0, doc.page.height / 2 - 50, { width: doc.page.width, align: 'center', lineBreak: false });
  doc.restore();
  doc.y = cursorY; // drawing the mark must not move the layout cursor
}

export function renderDocumentPdf(d: PdfDocumentData, opts: PdfOptions = {}): Promise<Buffer> {
  const isTax = d.taxMode !== 'NONE';
  const title = d.kind === 'QUOTATION' ? 'QUOTATION' : isTax ? 'TAX INVOICE' : 'INVOICE';
  const numberLabel = d.number ? `${d.number}${d.kind === 'QUOTATION' && d.revision && d.revision > 1 ? ` (Rev ${d.revision})` : ''}` : 'Draft (not yet numbered)';

  return renderTo(
    (doc) => {
      const pageW = doc.page.width;
      const contentW = pageW - MARGIN * 2;
      const bottomLimit = () => doc.page.height - 60;

      const newPage = () => {
        doc.addPage();
        header(doc, d.business, title, numberLabel);
        if (d.watermark) watermark(doc, d.watermark);
      };
      header(doc, d.business, title, numberLabel);
      if (d.watermark) watermark(doc, d.watermark);

      // --- Bill to / document details ---
      let y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text('BILL TO', MARGIN, y);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(d.customer.name, MARGIN, y + 12, { width: 280 });
      const custLines = [d.customer.address, [d.customer.phone && `Ph: ${d.customer.phone}`, d.customer.email].filter(Boolean).join('   '), d.customer.gstin ? `GSTIN: ${d.customer.gstin}` : null, d.customer.state ? `State: ${d.customer.state}` : null].filter(Boolean).join('\n');
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(custLines, MARGIN, doc.y + 2, { width: 280, lineGap: 1 });
      const leftEnd = doc.y;

      const metaX = pageW - MARGIN - 210;
      const meta: [string, string][] = [
        [`${d.kind === 'QUOTATION' ? 'Quotation' : 'Invoice'} no.`, numberLabel],
        ['Date', ymdLabel(d.date)],
        [d.secondDateLabel, ymdLabel(d.secondDate)],
        ['Status', d.status],
      ];
      if (isTax) meta.push(['Supply', d.taxMode === 'INTRA' ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)']);
      let my = y;
      for (const [k, v] of meta) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, metaX, my, { width: 80 });
        doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(v, metaX + 84, my, { width: 126 });
        my = Math.max(my + 14, doc.y + 2);
      }
      y = Math.max(leftEnd, my) + 14;

      // --- Items table ---
      const cols = isTax
        ? [
            { key: 'n', label: '#', w: 22, align: 'left' as const },
            { key: 'desc', label: 'Description', w: 176, align: 'left' as const },
            { key: 'qty', label: 'Qty', w: 52, align: 'right' as const },
            { key: 'rate', label: 'Rate', w: 62, align: 'right' as const },
            { key: 'disc', label: 'Disc.', w: 52, align: 'right' as const },
            { key: 'tax', label: 'GST %', w: 38, align: 'right' as const },
            { key: 'amt', label: 'Amount', w: 0, align: 'right' as const },
          ]
        : [
            { key: 'n', label: '#', w: 22, align: 'left' as const },
            { key: 'desc', label: 'Description', w: 222, align: 'left' as const },
            { key: 'qty', label: 'Qty', w: 60, align: 'right' as const },
            { key: 'rate', label: 'Rate', w: 70, align: 'right' as const },
            { key: 'disc', label: 'Disc.', w: 60, align: 'right' as const },
            { key: 'amt', label: 'Amount', w: 0, align: 'right' as const },
          ];
      cols[cols.length - 1].w = contentW - cols.slice(0, -1).reduce((a, c) => a + c.w, 0);
      const colX: number[] = [];
      cols.reduce((x, c) => (colX.push(x), x + c.w), MARGIN);

      const tableHeader = (yy: number) => {
        doc.rect(MARGIN, yy, contentW, 20).fill(BLACK);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GOLD_LIGHT);
        cols.forEach((c, i) => doc.text(c.label, colX[i] + 4, yy + 6, { width: c.w - 8, align: c.align, lineBreak: false }));
        return yy + 20;
      };
      y = tableHeader(y);

      d.lines.forEach((l, i) => {
        const gross = lineGross(l.quantity, l.rate);
        const desc = l.hsn ? `${l.description}\nHSN/SAC: ${l.hsn}` : l.description;
        doc.font('Helvetica').fontSize(9);
        const h = Math.max(doc.heightOfString(desc, { width: cols[1].w - 8 }) + 10, 22);
        if (y + h > bottomLimit()) {
          newPage();
          y = tableHeader(doc.y);
        }
        if (i % 2 === 1) doc.rect(MARGIN, y, contentW, h).fill(ZEBRA);
        doc.fillColor(INK).font('Helvetica').fontSize(9);
        const discText = l.discountAmount > 0 ? (l.discountType === 'PERCENT' ? `${qty(l.discountValue)}%` : num(l.discountAmount)) : '-';
        const cells: Record<string, string> = {
          n: String(i + 1),
          qty: `${qty(l.quantity)} ${l.unit}`,
          rate: num(l.rate),
          disc: discText,
          tax: qty(l.taxRate),
          amt: num(paiseToRupees(rupeesToPaise(gross) - rupeesToPaise(l.discountAmount))),
        };
        cols.forEach((c, ci) => {
          const text = c.key === 'desc' ? desc : cells[c.key];
          doc.text(text, colX[ci] + 4, y + 5, { width: c.w - 8, align: c.align });
        });
        y += h;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
      });

      // --- Totals ---
      const taxRows = taxSummary(d.lines, d.totals);
      const totalsRows: [string, string, boolean?][] = [['Subtotal', money(d.totals.subtotal)]];
      if (d.totals.discountAmount > 0) totalsRows.push(['Discount', `- ${money(d.totals.discountAmount)}`]);
      if (d.totals.shippingCharge > 0) totalsRows.push(['Shipping', money(d.totals.shippingCharge)]);
      if (d.totals.otherCharges > 0) totalsRows.push(['Other charges', money(d.totals.otherCharges)]);
      if (isTax) {
        totalsRows.push(['Taxable value', money(d.totals.taxableAmount)]);
        if (d.taxMode === 'INTRA') {
          totalsRows.push(['CGST', money(d.totals.cgstAmount)], ['SGST', money(d.totals.sgstAmount)]);
        } else totalsRows.push(['IGST', money(d.totals.igstAmount)]);
      }
      if (d.totals.roundOff !== 0) totalsRows.push(['Round off', `${d.totals.roundOff < 0 ? '-' : ''} ${money(Math.abs(d.totals.roundOff))}`]);
      const needed = totalsRows.length * 16 + 46 + (d.kind === 'INVOICE' && d.amountPaid !== undefined ? 40 : 0);
      if (y + needed > bottomLimit()) {
        newPage();
        y = doc.y;
      }
      y += 12;
      const totX = pageW - MARGIN - 230;
      for (const [k, v] of totalsRows) {
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(k, totX, y, { width: 110 });
        doc.font('Helvetica').fillColor(INK).text(v, totX + 110, y, { width: 120, align: 'right' });
        y += 16;
      }
      doc.rect(totX - 6, y, 236, 26).fill(BLACK);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD_LIGHT).text(d.kind === 'QUOTATION' ? 'TOTAL' : 'GRAND TOTAL', totX, y + 8, { width: 110 });
      doc.fillColor("#FFFFFF").text(money(d.totals.grandTotal), totX + 110, y + 8, { width: 114, align: "right" });
      y += 34;
      if (d.kind === 'INVOICE' && d.amountPaid !== undefined) {
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Amount paid', totX, y, { width: 110 });
        doc.fillColor(INK).text(money(d.amountPaid), totX + 110, y, { width: 120, align: 'right' });
        y += 16;
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Balance due', totX, y, { width: 110 });
        doc.text(money(d.outstanding ?? 0), totX + 110, y, { width: 120, align: 'right' });
        y += 20;
      }

      // Amount in words.
      doc.font('Helvetica').fontSize(9);
      const words = amountInWords(d.totals.grandTotal);
      const wordsH = doc.heightOfString(words, { width: contentW });
      if (y + wordsH + 20 > bottomLimit()) {
        newPage();
        y = doc.y;
      }
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text('AMOUNT IN WORDS', MARGIN, y);
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(words, MARGIN, y + 11, { width: contentW });
      y = doc.y + 12;

      // --- Tax summary ---
      if (isTax && taxRows.length) {
        const rowsH = taxRows.length * 14 + 22;
        if (y + rowsH > bottomLimit()) {
          newPage();
          y = doc.y;
        }
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text('TAX SUMMARY', MARGIN, y);
        y += 12;
        const tcols = d.taxMode === 'INTRA' ? ['GST %', 'Taxable value', 'CGST', 'SGST', 'Total tax'] : ['GST %', 'Taxable value', 'IGST', 'Total tax'];
        const tw = contentW / tcols.length;
        doc.rect(MARGIN, y, contentW, 16).fill('#EFEAD8');
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK);
        tcols.forEach((c, i) => doc.text(c, MARGIN + i * tw + 4, y + 4, { width: tw - 8, align: i === 0 ? 'left' : 'right', lineBreak: false }));
        y += 16;
        doc.font('Helvetica').fontSize(8.5);
        for (const r of taxRows) {
          const vals = d.taxMode === 'INTRA' ? [qty(r.rate), num(r.taxable), num(r.cgst), num(r.sgst), num(r.cgst + r.sgst)] : [qty(r.rate), num(r.taxable), num(r.igst), num(r.igst)];
          vals.forEach((v, i) => doc.text(v, MARGIN + i * tw + 4, y + 3, { width: tw - 8, align: i === 0 ? 'left' : 'right', lineBreak: false }));
          y += 14;
        }
        y += 10;
      }

      // --- Terms, notes, bank, signature ---
      const blocks: [string, string][] = [];
      if (d.paymentTerms) blocks.push(['PAYMENT TERMS', d.paymentTerms]);
      const bank = [d.business.bankAccountName && `Account name: ${d.business.bankAccountName}`, d.business.bankName && `Bank: ${d.business.bankName}${d.business.bankBranch ? `, ${d.business.bankBranch}` : ''}`, d.business.bankAccountNumber && `Account no.: ${d.business.bankAccountNumber}`, d.business.bankIfsc && `IFSC: ${d.business.bankIfsc}`, d.business.upiId && `UPI: ${d.business.upiId}`, d.business.paymentInstructions].filter(Boolean).join('\n');
      if (bank) blocks.push(['BANK & PAYMENT DETAILS', bank]);
      if (d.notes) blocks.push(['NOTES', d.notes]);
      if (d.terms) blocks.push(['TERMS & CONDITIONS', d.terms]);
      for (const [label, text] of blocks) {
        doc.font('Helvetica').fontSize(9);
        const h = doc.heightOfString(text, { width: contentW }) + 24;
        if (y + h > bottomLimit()) {
          newPage();
          y = doc.y;
        }
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text(label, MARGIN, y);
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(text, MARGIN, y + 11, { width: contentW, lineGap: 1.5 });
        y = doc.y + 10;
      }

      if (y + 70 > bottomLimit()) {
        newPage();
        y = doc.y;
      }
      const sigX = pageW - MARGIN - 190;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`For ${d.business.displayName}`, sigX, y + 6, { width: 190, align: 'center' });
      doc.moveTo(sigX, y + 56).lineTo(sigX + 190, y + 56).lineWidth(0.6).strokeColor(INK).stroke();
      doc.fontSize(8.5).text(d.business.signatoryLabel || 'Authorised signatory', sigX, y + 60, { width: 190, align: 'center' });
    },
    { title: `${title} ${d.number ?? 'Draft'}`, footerLeft: `${d.business.displayName}  |  ${title} ${d.number ?? 'Draft'}` },
    opts
  );
}

export function renderReceiptPdf(r: PdfReceiptData, opts: PdfOptions = {}): Promise<Buffer> {
  return renderTo(
    (doc) => {
      const pageW = doc.page.width;
      header(doc, r.business, 'PAYMENT RECEIPT', r.receiptNumber);
      if (r.voided) watermark(doc, 'VOIDED');
      let y = doc.y + 4;
      const rows: [string, string][] = [
        ['Receipt no.', r.receiptNumber],
        ['Date', ymdLabel(r.paidOn)],
        ['Received from', r.customer.name],
        ['Against invoice', r.invoiceNumber],
        ['Payment method', paymentMethodLabel(r.method)],
      ];
      if (r.reference) rows.push(['Reference', r.reference]);
      for (const [k, v] of rows) {
        doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(k, MARGIN, y, { width: 130 });
        doc.font('Helvetica-Bold').fillColor(INK).text(v, MARGIN + 140, y, { width: pageW - MARGIN * 2 - 140 });
        y = Math.max(y + 20, doc.y + 4);
      }
      y += 8;
      doc.rect(MARGIN, y, pageW - MARGIN * 2, 44).fill(BLACK);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD_LIGHT).text('AMOUNT RECEIVED', MARGIN + 14, y + 16, { width: 200 });
      doc.fontSize(16).fillColor('#FFFFFF').text(money(r.amount), pageW - MARGIN - 214, y + 13, { width: 200, align: 'right' });
      y += 58;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text('AMOUNT IN WORDS', MARGIN, y);
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(amountInWords(r.amount), MARGIN, y + 11, { width: pageW - MARGIN * 2 });
      y = doc.y + 14;
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Invoice total', MARGIN, y, { width: 130 });
      doc.fillColor(INK).text(money(r.invoiceTotal), MARGIN + 140, y);
      y += 18;
      doc.fillColor(MUTED).text('Balance after this payment', MARGIN, y, { width: 130 });
      doc.font('Helvetica-Bold').fillColor(INK).text(money(r.balanceAfter), MARGIN + 140, y);
      y += 26;
      if (r.notes) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Notes: ${r.notes}`, MARGIN, y, { width: pageW - MARGIN * 2 });
        y = doc.y + 10;
      }
      const sigX = pageW - MARGIN - 190;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`For ${r.business.displayName}`, sigX, y + 10, { width: 190, align: 'center' });
      doc.moveTo(sigX, y + 58).lineTo(sigX + 190, y + 58).lineWidth(0.6).strokeColor(INK).stroke();
      doc.fontSize(8.5).text(r.business.signatoryLabel || 'Authorised signatory', sigX, y + 62, { width: 190, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('This is a computer-generated receipt for a payment recorded against the invoice above.', MARGIN, y + 62, { width: 280 });
    },
    { title: `Receipt ${r.receiptNumber}`, footerLeft: `${r.business.displayName}  |  Receipt ${r.receiptNumber}` },
    opts
  );
}
