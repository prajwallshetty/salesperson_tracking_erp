import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, login, uid, type Session } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });

describe('concurrency & duplicate submissions', () => {
  let rahul: Session, admin: Session;
  let client: any, product: any;
  beforeAll(async () => {
    [rahul, admin] = await Promise.all([login('rahul@erp.com'), login('admin@erp.com')]);
    client = (await api('/api/clients', { token: rahul.token })).json.data.find((c: any) => c.name === 'City Electronics Hub');
    product = (await api('/api/products', { token: rahul.token })).json.data.find((p: any) => p.sku === 'SAM-CBL-02');
  });

  it('parallel orders get unique numbers and a consistent ledger', async () => {
    const before = Number((await db.client.findUnique({ where: { id: client.id } }))!.currentOutstanding);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api('/api/orders', { token: rahul.token, body: { clientId: client.id, items: [{ productId: product.id, quantity: 1 }] } }))
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const numbers = new Set(results.map((r) => r.json.data.orderNumber));
    expect(numbers.size).toBe(8);
    const each = Number(results[0].json.data.grandTotal);
    const after = Number((await db.client.findUnique({ where: { id: client.id } }))!.currentOutstanding);
    expect(after).toBeCloseTo(before + 8 * each, 2);

    // Running balances form a strictly consistent chain (row lock prevented lost updates).
    const entries = await db.clientLedgerEntry.findMany({ where: { orderId: { in: results.map((r) => r.json.data.id) } }, orderBy: { runningBalance: 'asc' } });
    entries.forEach((e, i) => expect(Number(e.runningBalance)).toBeCloseTo(before + (i + 1) * each, 2));
  });

  it('parallel requests with one idempotency key create exactly one order', async () => {
    const key = `dup-${uid()}`;
    const body = { clientId: client.id, items: [{ productId: product.id, quantity: 3 }], idempotencyKey: key, notes: key };
    const results = await Promise.all(Array.from({ length: 5 }, () => api('/api/orders', { token: rahul.token, body })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json.data.id)).size).toBe(1);
    expect(await db.order.count({ where: { notes: key } })).toBe(1);
  });

  it('parallel verification of one payment posts one ledger credit', async () => {
    const p = await api('/api/payments', { token: rahul.token, body: { clientId: client.id, amount: 100, paymentMethod: 'UPI' } });
    const results = await Promise.all(Array.from({ length: 4 }, () => api(`/api/payments/${p.json.data.id}/verify`, { token: admin.token, body: { status: 'VERIFIED' } })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.clientLedgerEntry.count({ where: { paymentId: p.json.data.id } })).toBe(1);
  });
});
