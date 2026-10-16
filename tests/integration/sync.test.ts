import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, login, uid, type Session } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });

describe('offline outbox sync', () => {
  let ahmed: Session;
  let client: any;
  let product: any;

  beforeAll(async () => {
    ahmed = await login('ahmed@erp.com');
    // Seeded ON_DUTY without an attendance row: end any stale state so START_DAY creates one.
    await api('/api/attendance/end', { token: ahmed.token, body: {} });
    client = (await api('/api/clients', { token: ahmed.token })).json.data[0];
    product = (await api('/api/products', { token: ahmed.token })).json.data.find((p: any) => p.sku === 'PWR-BNK-10K');
  });

  it('applies a whole offline day through the same business rules as online requests', async () => {
    const run = uid();
    const localVisit = `local-visit-${run}`;
    const now = Date.now();
    const items = [
      { localId: `l1-${run}`, type: 'START_DAY', idempotencyKey: `sd-${run}`, payload: { latitude: client.latitude, longitude: client.longitude, timestamp: new Date(now - 3600_000).toISOString() } },
      { localId: `l2-${run}`, type: 'GPS_BATCH', idempotencyKey: `gps-${run}`, payload: { points: [{ clientPointId: `g-${run}`, latitude: client.latitude, longitude: client.longitude, accuracy: 9, timestamp: new Date(now - 3000_000).toISOString() }] } },
      { localId: `l3-${run}`, type: 'VISIT_START', idempotencyKey: `visit-start-${localVisit}`, payload: { clientId: client.id, latitude: client.latitude, longitude: client.longitude, localVisitId: localVisit, startedAt: new Date(now - 2400_000).toISOString() } },
      { localId: `l4-${run}`, type: 'VISIT_END', idempotencyKey: `ve-${run}`, payload: { visitId: localVisit, outcome: 'ORDER_TAKEN', notes: 'offline', endedAt: new Date(now - 2000_000).toISOString() } },
      { localId: `l5-${run}`, type: 'ORDER', idempotencyKey: `ord-${run}`, payload: { clientId: client.id, items: [{ productId: product.id, quantity: 2 }], discount: 0, notes: `offline-${run}` } },
      { localId: `l6-${run}`, type: 'PAYMENT', idempotencyKey: `pay-${run}`, payload: { clientId: client.id, amount: 500, paymentMethod: 'CASH', collectedAt: new Date(now - 1000_000).toISOString() } },
      { localId: `l7-${run}`, type: 'EXPENSE', idempotencyKey: `exp-${run}`, payload: { category: 'PARKING_TOLLS', amount: 40, expenseDate: new Date().toISOString(), description: 'Parking offline', isSubmit: true } },
      { localId: `l8-${run}`, type: 'END_DAY', idempotencyKey: `ed-${run}`, payload: { latitude: client.latitude, longitude: client.longitude, timestamp: new Date().toISOString() } },
    ];

    const r = await api('/api/sync/batch', { token: ahmed.token, body: { items } });
    expect(r.status).toBe(200);
    for (const res of r.json.results) expect(res, JSON.stringify(res)).toMatchObject({ status: 'SYNCED' });

    // ORDER uses the shared calculator: item discount 50 applied (legacy sync ignored it).
    const order = await db.order.findFirst({ where: { notes: `offline-${run}` }, include: { items: true } });
    expect(Number(order!.subtotal)).toBe(2400);
    expect(Number(order!.discount)).toBe(50);
    expect(Number(order!.grandTotal)).toBe(Math.round((2350 * 1.18) * 100) / 100);
    expect(await db.clientLedgerEntry.count({ where: { orderId: order!.id, entryType: 'INVOICE' } })).toBe(1);

    // VISIT_END resolved the local visit id; visit closed.
    const visitId = r.json.results[2].serverId;
    expect(r.json.results[3].serverId).toBe(visitId);
    expect((await db.clientVisit.findUnique({ where: { id: visitId } }))!.outcome).toBe('ORDER_TAKEN');

    // Cash collection stays PENDING (cash_verification_required = true).
    const pay = await db.payment.findUnique({ where: { id: r.json.results[5].serverId } });
    expect(pay!.status).toBe('PENDING');

    // Offline-submitted expense is SUBMITTED (legacy saved it as DRAFT).
    const exp = await db.expense.findUnique({ where: { id: r.json.results[6].serverId } });
    expect(exp!.status).toBe('SUBMITTED');

    // END_DAY actually ended the day (legacy ignored it).
    const sp = await db.salesperson.findUnique({ where: { id: ahmed.user.salespersonId } });
    expect(sp!.status).toBe('OFF_DUTY');

    // Replaying the identical batch is a no-op.
    const counts = async () => ({
      orders: await db.order.count({ where: { notes: `offline-${run}` } }),
      payments: await db.payment.count({ where: { salespersonId: ahmed.user.salespersonId } }),
      visits: await db.clientVisit.count({ where: { salespersonId: ahmed.user.salespersonId } }),
      expenses: await db.expense.count({ where: { salespersonId: ahmed.user.salespersonId } }),
      attendance: await db.attendance.count({ where: { salespersonId: ahmed.user.salespersonId } }),
    });
    const before = await counts();
    const replay = await api('/api/sync/batch', { token: ahmed.token, body: { items } });
    expect(replay.json.results.every((x: any) => x.status === 'SYNCED')).toBe(true);
    expect(await counts()).toEqual(before);
  });

  it('reports per-item failures without losing the rest of the batch', async () => {
    const run = uid();
    const r = await api('/api/sync/batch', {
      token: ahmed.token,
      body: {
        items: [
          { localId: `bad-${run}`, type: 'ORDER', idempotencyKey: `bad-${run}`, payload: { clientId: client.id, items: [] } },
          { localId: `bad2-${run}`, type: 'TELEPORT', payload: {} },
          { localId: `good-${run}`, type: 'EXPENSE', idempotencyKey: `good-${run}`, payload: { category: 'OTHER', amount: 10, expenseDate: new Date().toISOString(), description: 'Stationery' } },
        ],
      },
    });
    expect(r.json.results.map((x: any) => x.status)).toEqual(['FAILED', 'FAILED', 'SYNCED']);
    expect(r.json.results[0].error).toMatch(/items/);
  });

  it('requires an items array', async () => {
    expect((await api('/api/sync/batch', { token: ahmed.token, body: {} })).status).toBe(400);
  });
});
