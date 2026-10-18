import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, login, uid, type Session } from './helpers';
import { calculateDocument } from '@/lib/domain/documentCalc';

/**
 * Quotation and invoice workflows against the real server and database: calculation, numbering,
 * revisions, conversion, issuing, payments, corrections, PDFs, permissions, tenant isolation and
 * audit history.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });
const GX = 'GlobexPass123!';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const shift = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

let admin: Session, manager: Session, rahul: Session, globex: Session;

const body = (over: Record<string, unknown> = {}) => ({
  customerName: `Customer ${uid()}`,
  customerPhone: '9000011111',
  customerState: 'Karnataka',
  lines: [{ description: 'Teak panel', quantity: 2, unit: 'PCS', rate: 1000, taxRate: 18, discountType: 'PERCENT', discountValue: 0 }],
  discountType: 'AMOUNT',
  discountValue: 0,
  shippingCharge: 0,
  otherCharges: 0,
  ...over,
});

const mkQuote = async (over: Record<string, unknown> = {}, s = admin) => (await api('/api/quotations', { token: s.token, body: body(over) })).json.data;
const mkInvoice = async (over: Record<string, unknown> = {}, s = admin) => (await api('/api/invoices', { token: s.token, body: body(over) })).json.data;
const issue = async (id: string, s = admin) => api(`/api/invoices/${id}/issue`, { token: s.token, body: {} });
const pay = (id: string, amount: number, over: Record<string, unknown> = {}, s = admin) =>
  api(`/api/invoices/${id}/payments`, { token: s.token, body: { amount, method: 'UPI', reference: 'UTR-1', idempotencyKey: `pay-${uid()}`, ...over } });
const getInv = async (id: string, s = admin) => (await api(`/api/invoices/${id}`, { token: s.token })).json.data;
const issuedInvoice = async (over: Record<string, unknown> = {}) => {
  const d = await mkInvoice(over);
  const r = await issue(d.id);
  expect(r.status).toBe(200);
  return r.json.data;
};

beforeAll(async () => {
  [admin, manager, rahul] = await Promise.all(['admin@erp.com', 'manager@erp.com', 'rahul@erp.com'].map((e) => login(e)));
  globex = await login('admin@erp.com', GX, 'globex');
  const r = await api('/api/billing/business', {
    method: 'PUT',
    token: admin.token,
    body: { displayName: 'Bharath Interior Decor', address: '1 Test Street', city: 'Mangalore', state: 'Karnataka', phone: '9000000000', gstin: '29ABCDE1234F1Z5', gstEnabled: true, defaultTaxRate: 18, roundTotal: true, quotationValidityDays: 15, invoiceDueDays: 15, bankName: 'Test Bank', bankAccountNumber: '000111222', bankIfsc: 'TEST0000001' },
  });
  expect(r.status).toBe(200);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('business settings', () => {
  it('only administrators change them; managers can read; invalid values are refused', async () => {
    expect((await api('/api/billing/business', { token: rahul.token })).status).toBe(403);
    expect((await api('/api/billing/business', { token: manager.token })).status).toBe(200);
    expect((await api('/api/billing/business', { method: 'PUT', token: manager.token, body: { displayName: 'x', gstEnabled: false, defaultTaxRate: 18, roundTotal: true, quotationValidityDays: 15, invoiceDueDays: 15 } })).status).toBe(403);
    const bad = await api('/api/billing/business', { method: 'PUT', token: admin.token, body: { displayName: 'Bharath Interior Decor', gstin: 'NOT-A-GSTIN', gstEnabled: true, defaultTaxRate: 18, roundTotal: true, quotationValidityDays: 15, invoiceDueDays: 15 } });
    expect(bad.status).toBe(400);
  });

  it('saved details persist after a reload', async () => {
    const r = await api('/api/billing/business', { token: admin.token });
    expect(r.json.data.gstin).toBe('29ABCDE1234F1Z5');
    expect(r.json.data.configured).toBe(true);
  });

  it('numbering settings are configurable and validated', async () => {
    const list = await api('/api/billing/sequences', { token: admin.token });
    expect(list.json.data.map((s: any) => s.kind).sort()).toEqual(['INVOICE', 'QUOTATION', 'RECEIPT']);
    expect((await api('/api/billing/sequences', { token: manager.token })).status).toBe(403);
    expect((await api('/api/billing/sequences', { method: 'PUT', token: admin.token, body: { kind: 'INVOICE', prefix: 'bad prefix!', padding: 4, yearMode: 'NONE', nextNumber: 1 } })).status).toBe(400);
  });
});

describe('quotations', () => {
  it('creates a draft with server-calculated totals and a configured number; edits persist', async () => {
    const q = await mkQuote();
    expect(q.number).toMatch(/^QT-/);
    expect(q.status).toBe('DRAFT');
    expect(q.taxMode).toBe('INTRA');
    expect(Number(q.grandTotal)).toBe(2360);
    expect(Number(q.cgstAmount)).toBe(180);
    expect(Number(q.sgstAmount)).toBe(180);

    const edit = await api(`/api/quotations/${q.id}`, { method: 'PUT', token: admin.token, body: body({ customerName: q.customerName, lines: [{ description: 'Teak panel', quantity: 3, unit: 'PCS', rate: 1000, taxRate: 18 }] }) });
    expect(edit.status).toBe(200);
    const again = (await api(`/api/quotations/${q.id}`, { token: admin.token })).json.data;
    expect(Number(again.grandTotal)).toBe(3540);
    expect(again.items).toHaveLength(1);
    expect(Number(again.items[0].quantity)).toBe(3);
  });

  it('an inter-state customer gets IGST, and a non-GST document charges no tax', async () => {
    const inter = await mkQuote({ customerState: 'Kerala' });
    expect(inter.taxMode).toBe('INTER');
    expect(Number(inter.igstAmount)).toBe(360);
    expect(Number(inter.cgstAmount)).toBe(0);
    const plain = await mkQuote({ taxMode: 'NONE' });
    expect(Number(plain.taxAmount)).toBe(0);
    expect(Number(plain.grandTotal)).toBe(2000);
  });

  it('matches an independent calculation with discounts, charges and rounding', async () => {
    const input = body({
      lines: [
        { description: 'A', quantity: 3, rate: 999.99, discountType: 'PERCENT', discountValue: 10, taxRate: 18 },
        { description: 'B', quantity: 2.5, rate: 19.99, discountType: 'AMOUNT', discountValue: 5, taxRate: 12 },
      ],
      discountType: 'PERCENT',
      discountValue: 7.5,
      shippingCharge: 123.45,
      otherCharges: 10,
      chargesTaxRate: 18,
    });
    const q = (await api('/api/quotations', { token: admin.token, body: input })).json.data;
    const expected = calculateDocument({
      taxMode: 'INTRA',
      roundTotal: true,
      discountType: 'PERCENT',
      discountValue: 7.5,
      shippingCharge: 123.45,
      otherCharges: 10,
      chargesTaxRate: 18,
      lines: input.lines.map((l: any) => ({ quantity: l.quantity, rate: l.rate, discountType: l.discountType, discountValue: l.discountValue, taxRate: l.taxRate })),
    });
    expect(Number(q.grandTotal)).toBe(expected.grandTotal);
    expect(Number(q.taxAmount)).toBe(expected.taxAmount);
    expect(Number(q.roundOff)).toBe(expected.roundOff);
    expect(Math.round((Number(q.taxableAmount) + Number(q.taxAmount) + Number(q.roundOff)) * 100)).toBe(Math.round(Number(q.grandTotal) * 100));
  });

  it('validates input (empty items, bad GSTIN, impossible dates)', async () => {
    expect((await api('/api/quotations', { token: admin.token, body: body({ lines: [] }) })).status).toBe(400);
    expect((await api('/api/quotations', { token: admin.token, body: body({ customerGstin: '123' }) })).status).toBe(400);
    expect((await api('/api/quotations', { token: admin.token, body: body({ quotationDate: today(), validUntil: shift(today(), -1) }) })).status).toBe(400);
    expect((await api('/api/quotations', { token: admin.token, body: body({ lines: [{ description: 'x', quantity: 0, rate: 5 }] }) })).status).toBe(400);
  });

  it('parallel creates get unique, never-duplicated numbers', async () => {
    const made = await Promise.all(Array.from({ length: 6 }, () => api('/api/quotations', { token: admin.token, body: body() })));
    expect(made.every((m) => m.status === 201)).toBe(true);
    const numbers = made.map((m) => m.json.data.number);
    expect(new Set(numbers).size).toBe(6);
  });

  it('sending locks edits; accept/reject follow the workflow; revisions keep history', async () => {
    const q = await mkQuote();
    expect((await api(`/api/quotations/${q.id}/respond`, { token: admin.token, body: { decision: 'ACCEPTED' } })).status).toBe(409); // not sent yet
    const sent = await api(`/api/quotations/${q.id}/send`, { token: admin.token, body: {} });
    expect(sent.json.data.status).toBe('SENT');
    expect((await api(`/api/quotations/${q.id}`, { method: 'PUT', token: admin.token, body: body() })).status).toBe(409);
    expect((await api(`/api/quotations/${q.id}`, { method: 'DELETE', token: admin.token })).status).toBe(409);
    expect((await api(`/api/quotations/${q.id}/respond`, { token: admin.token, body: { decision: 'REJECTED' } })).status).toBe(400); // reason required

    const rev = await api(`/api/quotations/${q.id}/revise`, { token: admin.token, body: {} });
    expect(rev.status).toBe(201);
    expect(rev.json.data.number).toBe(q.number);
    expect(rev.json.data.revision).toBe(2);
    expect(rev.json.data.status).toBe('DRAFT');
    expect((await api(`/api/quotations/${q.id}/revise`, { token: admin.token, body: {} })).status).toBe(409); // already superseded

    const first = (await api(`/api/quotations/${q.id}`, { token: admin.token })).json.data;
    expect(first.status).toBe('REVISED');
    expect(Number(first.grandTotal)).toBe(Number(q.grandTotal)); // history is untouched
    expect(first.revisions.map((r: any) => r.revision)).toEqual([1, 2]);

    // The list shows only the latest revision unless asked for all.
    const latest = (await api(`/api/quotations?q=${q.number}`, { token: admin.token })).json;
    expect(latest.data).toHaveLength(1);
    expect((await api(`/api/quotations?q=${q.number}&includeRevisions=true`, { token: admin.token })).json.data).toHaveLength(2);
  });

  it('accepted quotation converts to a draft invoice with the same customer, lines, prices and tax — once', async () => {
    const q = await mkQuote({ discountType: 'AMOUNT', discountValue: 100, shippingCharge: 50, chargesTaxRate: 18 });
    expect((await api(`/api/quotations/${q.id}/convert`, { token: admin.token, body: {} })).status).toBe(409); // not accepted
    await api(`/api/quotations/${q.id}/send`, { token: admin.token, body: {} });
    await api(`/api/quotations/${q.id}/respond`, { token: admin.token, body: { decision: 'ACCEPTED' } });

    const c = await api(`/api/quotations/${q.id}/convert`, { token: admin.token, body: {} });
    expect(c.status).toBe(201);
    const inv = c.json.data;
    expect(inv.status).toBe('DRAFT');
    expect(inv.number).toBeNull();
    expect(inv.quotationId).toBe(q.id);
    expect(inv.customerName).toBe(q.customerName);
    expect(inv.taxMode).toBe(q.taxMode);
    for (const k of ['subtotal', 'discountAmount', 'taxableAmount', 'cgstAmount', 'sgstAmount', 'taxAmount', 'roundOff', 'grandTotal']) expect(Number(inv[k])).toBe(Number(q[k]));
    expect(inv.items).toHaveLength(q.items.length);
    expect(Number(inv.items[0].rate)).toBe(Number(q.items[0].rate));

    const again = await api(`/api/quotations/${q.id}/convert`, { token: admin.token, body: {} });
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(inv.id);
    const parallel = await Promise.all([1, 2, 3].map(() => api(`/api/quotations/${q.id}/convert`, { token: admin.token, body: {} })));
    expect(new Set(parallel.map((p) => p.json.data.id))).toEqual(new Set([inv.id]));
    expect((await api(`/api/quotations/${q.id}/revise`, { token: admin.token, body: {} })).status).toBe(409); // already invoiced
  });

  it('a sent quotation past its validity date expires', async () => {
    const q = await mkQuote({ quotationDate: today(), validUntil: today() });
    await api(`/api/quotations/${q.id}/send`, { token: admin.token, body: {} });
    await db.quotation.update({ where: { id: q.id }, data: { validUntil: new Date(`${shift(today(), -1)}T00:00:00Z`) } });
    const read = (await api(`/api/quotations/${q.id}`, { token: admin.token })).json.data;
    expect(read.status).toBe('EXPIRED');
    expect((await api(`/api/quotations/${q.id}/respond`, { token: admin.token, body: { decision: 'ACCEPTED' } })).status).toBe(409);
    expect((await api(`/api/quotations/${q.id}/revise`, { token: admin.token, body: {} })).status).toBe(201);
  });

  it('duplicates into a new numbered draft; lists filter, search and sort', async () => {
    const q = await mkQuote({ customerName: `Dup ${uid()}` });
    const d = await api(`/api/quotations/${q.id}/duplicate`, { token: admin.token, body: {} });
    expect(d.status).toBe(201);
    expect(d.json.data.number).not.toBe(q.number);
    expect(d.json.data.status).toBe('DRAFT');
    expect(d.json.data.customerName).toBe(q.customerName);
    const byName = (await api(`/api/quotations?q=${encodeURIComponent(q.customerName)}`, { token: admin.token })).json;
    expect(byName.total).toBe(2);
    const asc = (await api(`/api/quotations?sort=total&dir=asc&status=DRAFT`, { token: admin.token })).json.data.map((r: any) => Number(r.grandTotal));
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);
    const range = (await api(`/api/quotations?from=${shift(today(), 1)}&to=${shift(today(), 2)}`, { token: admin.token })).json;
    expect(range.total).toBe(0);
  });

  it('PDF is generated from the saved quotation', async () => {
    const q = await mkQuote();
    const res = await fetch(`${process.env.TEST_BASE_URL || 'http://localhost:3100'}/api/quotations/${q.id}/pdf`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(`Quotation-${q.number}`);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('invoices', () => {
  it('creates an independent draft that can be edited and persists', async () => {
    const d = await mkInvoice();
    expect(d.status).toBe('DRAFT');
    expect(d.number).toBeNull();
    expect(Number(d.grandTotal)).toBe(2360);
    expect(d.dueDate.slice(0, 10)).toBe(shift(d.invoiceDate.slice(0, 10), 15));
    const upd = await api(`/api/invoices/${d.id}`, { method: 'PUT', token: admin.token, body: body({ customerName: d.customerName, discountType: 'PERCENT', discountValue: 10, lines: [{ description: 'Teak panel', quantity: 2, rate: 1000, taxRate: 18 }] }) });
    expect(upd.status).toBe(200);
    const read = await getInv(d.id);
    expect(Number(read.discountAmount)).toBe(200);
    expect(Number(read.grandTotal)).toBe(2124); // 1800 + 2 × 162
  });

  it('issuing numbers the invoice, freezes it and records the history', async () => {
    const d = await mkInvoice();
    const inv = (await issue(d.id)).json.data;
    expect(inv.number).toMatch(/^INV-/);
    expect(inv.status).toBe('ISSUED');
    expect(inv.businessSnapshot.gstin).toBe('29ABCDE1234F1Z5');
    expect((await issue(d.id)).status).toBe(409);
    expect((await api(`/api/invoices/${d.id}`, { method: 'PUT', token: admin.token, body: body() })).status).toBe(409);
    expect((await api(`/api/invoices/${d.id}`, { method: 'DELETE', token: admin.token })).status).toBe(409);
    const read = await getInv(d.id);
    expect(Number(read.grandTotal)).toBe(2360);
    expect(read.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['ISSUE_INVOICE', 'CREATE_INVOICE']));
  });

  it('issued numbers are unique and consecutive even when issued in parallel', async () => {
    const drafts = await Promise.all(Array.from({ length: 5 }, () => mkInvoice()));
    const issued = await Promise.all(drafts.map((d) => issue(d.id)));
    expect(issued.every((r) => r.status === 200)).toBe(true);
    const nums = issued.map((r) => Number(r.json.data.number.match(/(\d+)$/)![1])).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(5);
    expect(nums[4] - nums[0]).toBe(4);
  });

  it('a GST invoice cannot be issued without a business GSTIN', async () => {
    const d = await mkInvoice();
    const keep = (await api('/api/billing/business', { token: admin.token })).json.data;
    const { configured: _c, ...rest } = keep;
    const clear = (gstin: string) => api('/api/billing/business', { method: 'PUT', token: admin.token, body: { ...rest, gstin } });
    expect((await clear('')).status).toBe(200);
    const blocked = await issue(d.id);
    expect(blocked.status).toBe(400);
    expect(blocked.json.error).toMatch(/GSTIN/);
    expect((await clear(keep.gstin)).status).toBe(200);
    expect((await issue(d.id)).status).toBe(200);
  });

  it('later settings changes never rewrite an issued invoice', async () => {
    const inv = await issuedInvoice();
    const keep = (await api('/api/billing/business', { token: admin.token })).json.data;
    const { configured: _c, ...rest } = keep;
    await api('/api/billing/business', { method: 'PUT', token: admin.token, body: { ...rest, displayName: 'Renamed Co', address: 'Elsewhere' } });
    const read = await getInv(inv.id);
    expect(read.businessSnapshot.displayName).toBe('Bharath Interior Decor');
    expect(Number(read.grandTotal)).toBe(Number(inv.grandTotal));
    await api('/api/billing/business', { method: 'PUT', token: admin.token, body: { ...rest } });
  });

  it('partial then full payment: balances, statuses and receipts', async () => {
    const inv = await issuedInvoice();
    expect((await pay(inv.id, 2361)).status).toBe(400); // more than outstanding
    expect((await pay(inv.id, 0)).status).toBe(400);

    const p1 = await pay(inv.id, 1000);
    expect(p1.status).toBe(201);
    expect(p1.json.data.receiptNumber).toMatch(/^RCT-/);
    expect(p1.json.invoice.status).toBe('PARTIALLY_PAID');
    expect(Number(p1.json.invoice.amountPaid)).toBe(1000);
    expect(p1.json.invoice.outstanding).toBe(1360);

    const p2 = await pay(inv.id, 1360, { method: 'CASH', reference: undefined });
    expect(p2.json.invoice.status).toBe('PAID');
    expect(p2.json.invoice.outstanding).toBe(0);
    expect((await pay(inv.id, 1)).status).toBe(409); // fully paid

    const read = await getInv(inv.id);
    expect(read.payments.map((p: any) => Number(p.amount))).toEqual([1000, 1360]);
    expect(read.history.map((h: any) => h.action)).toContain('PAYMENT_RECORDED');

    const rec = await fetch(`${process.env.TEST_BASE_URL || 'http://localhost:3100'}/api/invoices/${inv.id}/payments/${p1.json.data.id}/receipt`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(rec.status).toBe(200);
    expect(rec.headers.get('content-type')).toBe('application/pdf');
  });

  it('submitting the same payment twice (or in parallel) records it once', async () => {
    const inv = await issuedInvoice();
    const key = `pay-${uid()}`;
    const first = await pay(inv.id, 500, { idempotencyKey: key });
    const second = await pay(inv.id, 500, { idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.data.id).toBe(first.json.data.id);

    const k2 = `pay-${uid()}`;
    const burst = await Promise.all(Array.from({ length: 6 }, () => pay(inv.id, 100, { idempotencyKey: k2 })));
    expect(burst.every((b) => [200, 201].includes(b.status))).toBe(true);
    const read = await getInv(inv.id);
    expect(read.payments).toHaveLength(2);
    expect(Number(read.amountPaid)).toBe(600);
  });

  it('parallel different payments can never exceed the invoice total', async () => {
    const inv = await issuedInvoice();
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(inv.id, 1000)));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(2); // 2 × 1000 fits in 2360; the rest are refused
    const read = await getInv(inv.id);
    expect(Number(read.amountPaid)).toBeLessThanOrEqual(Number(read.grandTotal));
  });

  it('voiding a payment restores the balance and keeps the record', async () => {
    const inv = await issuedInvoice();
    const p = await pay(inv.id, 2360);
    expect(p.json.invoice.status).toBe('PAID');
    expect((await api(`/api/invoices/${inv.id}/payments/${p.json.data.id}/void`, { token: admin.token, body: {} })).status).toBe(400); // reason required
    const v = await api(`/api/invoices/${inv.id}/payments/${p.json.data.id}/void`, { token: admin.token, body: { reason: 'Cheque bounced' } });
    expect(v.status).toBe(200);
    expect(v.json.data.status).toBe('ISSUED');
    expect(v.json.data.outstanding).toBe(2360);
    expect((await api(`/api/invoices/${inv.id}/payments/${p.json.data.id}/void`, { token: admin.token, body: { reason: 'again' } })).status).toBe(409);
    const read = await getInv(inv.id);
    expect(read.payments[0].status).toBe('VOIDED');
    expect(read.payments[0].voidReason).toBe('Cheque bounced');
  });

  it('cancelling needs the payments voided first; cancelled invoices keep their figures', async () => {
    const inv = await issuedInvoice();
    await pay(inv.id, 500);
    expect((await api(`/api/invoices/${inv.id}/cancel`, { token: admin.token, body: { reason: 'Wrong customer' } })).status).toBe(409);
    const read = await getInv(inv.id);
    await api(`/api/invoices/${inv.id}/payments/${read.payments[0].id}/void`, { token: admin.token, body: { reason: 'Refunded' } });
    expect((await api(`/api/invoices/${inv.id}/cancel`, { token: admin.token, body: {} })).status).toBe(400); // reason required
    const c = await api(`/api/invoices/${inv.id}/cancel`, { token: admin.token, body: { reason: 'Wrong customer' } });
    expect(c.json.data.status).toBe('CANCELLED');
    expect(Number(c.json.data.grandTotal)).toBe(2360);
    expect(c.json.data.number).toBe(inv.number);
    expect((await pay(inv.id, 10)).status).toBe(409);
  });

  it('correction cancels the original and opens one linked editable copy', async () => {
    const inv = await issuedInvoice();
    const r = await api(`/api/invoices/${inv.id}/correct`, { token: admin.token, body: { reason: 'Wrong quantity' } });
    expect(r.status).toBe(201);
    const copy = r.json.data;
    expect(copy.status).toBe('DRAFT');
    expect(copy.correctsInvoiceId).toBe(inv.id);
    expect(copy.number).toBeNull();
    expect((await getInv(inv.id)).status).toBe('CANCELLED');
    const again = await api(`/api/invoices/${inv.id}/correct`, { token: admin.token, body: { reason: 'Wrong quantity' } });
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(copy.id);

    const fixed = await api(`/api/invoices/${copy.id}`, { method: 'PUT', token: admin.token, body: body({ customerName: copy.customerName, lines: [{ description: 'Teak panel', quantity: 1, rate: 1000, taxRate: 18 }] }) });
    expect(Number(fixed.json.data.grandTotal)).toBe(1180);
    const reissued = (await issue(copy.id)).json.data;
    expect(reissued.number).not.toBe(inv.number);
    const origin = await getInv(inv.id);
    expect(origin.correctedBy.map((c: any) => c.id)).toContain(copy.id);
  });

  it('an invoice with payments cannot be corrected until they are voided', async () => {
    const inv = await issuedInvoice();
    await pay(inv.id, 100);
    expect((await api(`/api/invoices/${inv.id}/correct`, { token: admin.token, body: { reason: 'Typo in address' } })).status).toBe(409);
  });

  it('open invoices past their due date are overdue, until paid', async () => {
    const d = await mkInvoice({ invoiceDate: shift(today(), -20), dueDate: shift(today(), -5) });
    const inv = (await issue(d.id)).json.data;
    expect(inv.displayStatus).toBe('OVERDUE');
    const overdue = (await api('/api/invoices?status=OVERDUE&limit=200', { token: admin.token })).json;
    expect(overdue.data.map((r: any) => r.id)).toContain(inv.id);
    const paid = await pay(inv.id, 2360);
    expect(paid.json.invoice.displayStatus).toBe('PAID');
    expect((await api('/api/invoices?status=OVERDUE&limit=200', { token: admin.token })).json.data.map((r: any) => r.id)).not.toContain(inv.id);
  });

  it('lists filter by status, number, customer and date; the summary adds up', async () => {
    const name = `Filter ${uid()}`;
    const a = await issuedInvoice({ customerName: name });
    await pay(a.id, 1000);
    const list = (await api(`/api/invoices?q=${encodeURIComponent(name)}`, { token: admin.token })).json;
    expect(list.total).toBe(1);
    expect(list.summary).toEqual({ billed: 2360, collected: 1000, outstanding: 1360 });
    expect((await api(`/api/invoices?q=${a.number}`, { token: admin.token })).json.total).toBe(1);
    expect((await api(`/api/invoices?q=${encodeURIComponent(name)}&status=PAID`, { token: admin.token })).json.total).toBe(0);
    expect((await api(`/api/invoices?q=${encodeURIComponent(name)}&status=PARTIALLY_PAID`, { token: admin.token })).json.total).toBe(1);
    expect((await api(`/api/invoices?q=${encodeURIComponent(name)}&from=${shift(today(), 1)}`, { token: admin.token })).json.total).toBe(0);
    expect((await api('/api/invoices?from=bad-date', { token: admin.token })).status).toBe(400);
  });

  it('invoice PDF reflects the saved totals', async () => {
    const inv = await issuedInvoice();
    const res = await fetch(`${process.env.TEST_BASE_URL || 'http://localhost:3100'}/api/invoices/${inv.id}/pdf?download=1`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain(`Invoice-${inv.number}`);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('access control and tenant isolation', () => {
  it('salespersons have no access to quotations, invoices or payments', async () => {
    const q = await mkQuote();
    const inv = await mkInvoice();
    for (const [method, path] of [
      ['GET', '/api/quotations'],
      ['POST', '/api/quotations'],
      ['GET', `/api/quotations/${q.id}`],
      ['GET', `/api/quotations/${q.id}/pdf`],
      ['GET', '/api/invoices'],
      ['POST', '/api/invoices'],
      ['GET', `/api/invoices/${inv.id}`],
      ['POST', `/api/invoices/${inv.id}/issue`],
      ['POST', `/api/invoices/${inv.id}/payments`],
    ]) {
      const r = await api(path, { method, token: rahul.token, body: method === 'POST' ? {} : undefined });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    const anon = await api('/api/invoices');
    expect(anon.status).toBe(401);
  });

  it('manager permissions: viewing payments allows drafting; verifying payments allows issuing and money', async () => {
    const setPerm = (p: Record<string, boolean>) => api(`/api/settings/permissions/${manager.user.id}`, { method: 'PUT', token: admin.token, body: p });
    const draft = await mkInvoice({}, manager);
    expect(draft.status).toBe('DRAFT');
    try {
      expect((await setPerm({ canVerifyPayments: false })).status).toBe(200);
      expect((await issue(draft.id, manager)).status).toBe(403);
      expect((await api(`/api/invoices/${draft.id}`, { token: manager.token })).status).toBe(200);
      expect((await setPerm({ canVerifyPayments: true, canViewPayments: false })).status).toBe(200);
      expect((await api('/api/invoices', { token: manager.token })).status).toBe(403);
      expect((await api('/api/quotations', { token: manager.token })).status).toBe(403);
    } finally {
      await setPerm({ canVerifyPayments: true, canViewPayments: true });
    }
    expect((await issue(draft.id, manager)).status).toBe(200);
  });

  it("another company cannot read, change, pay or print this company's documents", async () => {
    const q = await mkQuote();
    const inv = await issuedInvoice();
    for (const path of [`/api/quotations/${q.id}`, `/api/quotations/${q.id}/pdf`, `/api/invoices/${inv.id}`, `/api/invoices/${inv.id}/pdf`]) {
      expect((await api(path, { token: globex.token })).status, path).toBe(404);
    }
    expect((await api(`/api/quotations/${q.id}`, { method: 'PUT', token: globex.token, body: body() })).status).toBe(404);
    expect((await pay(inv.id, 10, {}, globex)).status).toBe(404);
    expect((await api(`/api/invoices/${inv.id}/cancel`, { token: globex.token, body: { reason: 'attack' } })).status).toBe(404);
    expect((await api(`/api/quotations/${q.id}/convert`, { token: globex.token, body: {} })).status).toBe(404);
    const list = (await api('/api/invoices?limit=200', { token: globex.token })).json;
    expect(list.data.map((r: any) => r.id)).not.toContain(inv.id);
    // The company's own copy is untouched.
    expect((await getInv(inv.id)).status).toBe('ISSUED');
  });

  it('a client linked to a document must be one the manager may see', async () => {
    const clients = (await api('/api/clients?limit=200', { token: admin.token })).json.data as any[];
    const mine = (await api('/api/clients?limit=200', { token: manager.token })).json.data as any[];
    const outside = clients.find((c) => !mine.some((m) => m.id === c.id));
    if (!outside) return; // seed data has every client inside the manager's team
    const r = await api('/api/invoices', { token: manager.token, body: body({ clientId: outside.id }) });
    expect(r.status).toBe(403);
  });
});
