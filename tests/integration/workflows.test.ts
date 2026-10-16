import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, login, uid, type Session } from './helpers';

/**
 * Full field day for Vishal (seeded OFF DUTY, client "Ocean Telecom Udupi"):
 * Start day → GPS → visit → order → collection → verification → cancellation → end day.
 * Every step is checked against the database, not just the HTTP response.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });

describe('field sales lifecycle', () => {
  let admin: Session, vishal: Session;
  let client: any;
  let products: Record<string, any>;
  let orderId: string;
  let paymentId: string;
  let outstandingBefore: number;

  beforeAll(async () => {
    admin = await login('admin@erp.com');
    vishal = await login('vishal@erp.com');
    const clients = await api('/api/clients', { token: vishal.token });
    client = clients.json.data.find((c: any) => c.name === 'Ocean Telecom Udupi');
    const p = await api('/api/products', { token: vishal.token });
    products = Object.fromEntries(p.json.data.map((x: any) => [x.sku, x]));
    outstandingBefore = client.currentOutstanding;
  });

  it('rejects GPS before the day is started', async () => {
    const r = await api('/api/location/update', {
      token: vishal.token,
      body: { points: [{ latitude: 13.34, longitude: 74.74, timestamp: new Date().toISOString() }] },
    });
    expect(r.status).toBe(403);
  });

  it('starts the day and opens a tracking session', async () => {
    const r = await api('/api/attendance/start', { token: vishal.token, body: { latitude: 13.3401, longitude: 74.7415, idempotencyKey: `start-${uid()}` } });
    expect(r.status).toBe(201);
    expect(r.json.data.status).toBe('ON_DUTY');
    const again = await api('/api/attendance/start', { token: vishal.token, body: {} });
    expect(again.status).toBe(400);
    const sp = await db.salesperson.findUnique({ where: { id: vishal.user.salespersonId } });
    expect(sp?.status).toBe('ON_DUTY');
    const today = await api('/api/attendance/today', { token: vishal.token });
    expect(today.json.data.status).toBe('ON_DUTY');
  });

  it('ingests device GPS points and flags implausible ones', async () => {
    // Slightly ahead of the start-day breadcrumb (server accepts ≤5 min clock skew).
    const t = Date.now() + 150000;
    const r = await api('/api/location/batch', {
      token: vishal.token,
      body: {
        points: [
          { clientPointId: `p1-${uid()}`, latitude: 13.3402, longitude: 74.7416, accuracy: 8, speed: 12, batteryLevel: 81, timestamp: new Date(t - 120000).toISOString() },
          { clientPointId: `p2-${uid()}`, latitude: 13.3405, longitude: 74.7419, accuracy: 6, speed: 10, batteryLevel: 80, timestamp: new Date(t - 60000).toISOString() },
          // 1,000 km jump in 30 s → flagged, not deleted.
          { clientPointId: `p3-${uid()}`, latitude: 22.5, longitude: 88.3, accuracy: 5, timestamp: new Date(t - 30000).toISOString() },
          { latitude: 200, longitude: 74.7, timestamp: new Date(t).toISOString() },
        ],
      },
    });
    expect(r.status).toBe(400); // latitude 200 fails schema validation
    const ok = await api('/api/location/batch', {
      token: vishal.token,
      body: {
        points: [
          { clientPointId: `p1-${uid()}`, latitude: 13.3402, longitude: 74.7416, accuracy: 8, speed: 12, batteryLevel: 81, timestamp: new Date(t - 120000).toISOString() },
          { clientPointId: `p2-${uid()}`, latitude: 13.3405, longitude: 74.7419, accuracy: 6, speed: 10, batteryLevel: 80, timestamp: new Date(t - 60000).toISOString() },
          { clientPointId: `p3-${uid()}`, latitude: 22.5, longitude: 88.3, accuracy: 5, timestamp: new Date(t - 30000).toISOString() },
        ],
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.pointsIngested).toBe(3);
    const flagged = await db.locationPoint.findMany({ where: { salespersonId: vishal.user.salespersonId, isFiltered: true } });
    expect(flagged.some((p) => p.filterReason === 'IMPLAUSIBLE_SPEED_JUMP')).toBe(true);
  });

  it('live map shows the last accepted fix (never the flagged one) with real telemetry', async () => {
    const live = await api('/api/location/current', { token: admin.token });
    const me = live.json.data.find((s: any) => s.salespersonId === vishal.user.salespersonId);
    expect(me.isOnline).toBe(true);
    expect(me.currentLocation.latitude).toBeCloseTo(13.3405, 4);
    expect(me.assignedClients.map((c: any) => c.name)).toContain('Ocean Telecom Udupi');
    const status = await api('/api/salespersons/live-status', { token: admin.token });
    const st = status.json.data.find((s: any) => s.id === vishal.user.salespersonId);
    expect(st.batteryLevel).toBe(80);
    expect(st.networkType).toBeNull(); // not reported → not invented
  });

  it('starts a visit with server-computed GPS distance and radius exception', async () => {
    const near = await api('/api/visits/start', { token: vishal.token, body: { clientId: client.id, latitude: 13.3409, longitude: 74.7421 } });
    expect(near.status).toBe(201);
    expect(near.json.data.distanceMeters).toBe(0);
    expect(near.json.data.isException).toBe(false);

    const end = await api(`/api/visits/${near.json.data.visitId}/end`, { token: vishal.token, body: { outcome: 'ORDER_TAKEN', notes: 'Discussed festival stock' } });
    expect(end.status).toBe(200);
    expect((await api(`/api/visits/${near.json.data.visitId}/end`, { token: vishal.token, body: { outcome: 'NO_ORDER' } })).status).toBe(400);

    const far = await api('/api/visits/start', { token: vishal.token, body: { clientId: client.id, latitude: 13.36, longitude: 74.76 } });
    expect(far.json.data.isException).toBe(true);
    expect(far.json.data.exceptionReason).toMatch(/exceeded allowed radius of 100m/);
    const row = await db.clientVisit.findUnique({ where: { id: far.json.data.visitId } });
    expect(row?.distanceFromClient).toBeGreaterThan(2000);
  });

  it('creates an order with exact GST arithmetic, deducts stock and posts the invoice', async () => {
    const stockBefore = (await db.product.findUnique({ where: { sku: 'SAM-CHG-01' } }))!.stock;
    const key = `order-${uid()}`;
    const body = {
      clientId: client.id,
      items: [
        { productId: products['SAM-CHG-01'].id, quantity: 10 },
        { productId: products['SAM-CBL-02'].id, quantity: 5 },
        { productId: products['SAM-ADP-03'].id, quantity: 2 },
      ],
      discount: 450,
      notes: 'Festival order',
      idempotencyKey: key,
    };
    const r = await api('/api/orders', { token: vishal.token, body });
    expect(r.status).toBe(201);
    const o = r.json.data;
    orderId = o.id;
    // Legacy-verified figures: 7,050 subtotal, 450 discount, 1,188 GST, 7,788 total.
    expect(Number(o.subtotal)).toBe(7050);
    expect(Number(o.discount)).toBe(450);
    expect(Number(o.tax)).toBe(1188);
    expect(Number(o.grandTotal)).toBe(7788);
    expect(o.status).toBe('CONFIRMED');
    expect(o.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);

    const replay = await api('/api/orders', { token: vishal.token, body });
    expect(replay.status).toBe(201);
    expect(replay.json.data.id).toBe(orderId);
    expect(await db.order.count({ where: { notes: 'Festival order' } })).toBe(1);

    expect((await db.product.findUnique({ where: { sku: 'SAM-CHG-01' } }))!.stock).toBe(stockBefore - 10);
    const c = await db.client.findUnique({ where: { id: client.id } });
    expect(Number(c!.currentOutstanding)).toBe(outstandingBefore + 7788);
    const ledger = await db.clientLedgerEntry.findFirst({ where: { orderId, entryType: 'INVOICE' } });
    expect(Number(ledger!.runningBalance)).toBe(outstandingBefore + 7788);
  });

  it('rejects invalid orders with useful errors', async () => {
    expect((await api('/api/orders', { token: vishal.token, body: { clientId: client.id, items: [] } })).json.error).toBe('Validation failed');
    const bad = await api('/api/orders', { token: vishal.token, body: { clientId: client.id, items: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }] } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/not found/);
    expect((await api('/api/orders', { token: vishal.token, body: { clientId: client.id, items: [{ productId: products['SAM-CHG-01'].id, quantity: 0 }] } })).status).toBe(400);
  });

  it('records a collection as PENDING and only verification reduces the outstanding', async () => {
    const r = await api('/api/payments', {
      token: vishal.token,
      body: { clientId: client.id, orderId, amount: 5000, paymentMethod: 'UPI', transactionReference: 'UPI-123', idempotencyKey: `pay-${uid()}` },
    });
    expect(r.status).toBe(201);
    expect(r.json.data.status).toBe('PENDING');
    expect(r.json.data.receiptNumber).toMatch(/^PAY-\d{4}-\d{5}$/);
    paymentId = r.json.data.id;

    let c = await db.client.findUnique({ where: { id: client.id } });
    expect(Number(c!.currentOutstanding)).toBe(outstandingBefore + 7788);

    const v = await api(`/api/payments/${paymentId}/verify`, { token: admin.token, body: { status: 'VERIFIED', notes: 'UTR matched' } });
    expect(v.status).toBe(200);
    c = await db.client.findUnique({ where: { id: client.id } });
    expect(Number(c!.currentOutstanding)).toBe(outstandingBefore + 2788);

    // Legacy allowed VERIFIED → REJECTED (leaving the credit posted). Now refused.
    expect((await api(`/api/payments/${paymentId}/verify`, { token: admin.token, body: { status: 'REJECTED' } })).status).toBe(400);
    expect((await api(`/api/payments/${paymentId}/verify`, { token: admin.token, body: { status: 'VERIFIED' } })).json.error).toBe('Payment is already verified');
  });

  it('serves the PDF receipt to its owner and admins only', async () => {
    const own = await fetch(`${process.env.TEST_BASE_URL}/api/payments/${paymentId}/receipt-pdf?token=${vishal.token}`);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await own.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const rahul = await login('rahul@erp.com');
    expect((await api(`/api/payments/${paymentId}/receipt-pdf`, { token: rahul.token })).status).toBe(403);
  });

  it('order status workflow posts and reverses the invoice exactly once', async () => {
    const stock = async () => (await db.product.findUnique({ where: { sku: 'SAM-CHG-01' } }))!.stock;
    const invoices = () => db.clientLedgerEntry.count({ where: { orderId, entryType: 'INVOICE' } });
    const stockAtConfirm = await stock();

    for (const s of ['PROCESSING', 'CONFIRMED', 'DISPATCHED', 'DELIVERED']) {
      expect((await api(`/api/orders/${orderId}/status`, { method: 'PUT', token: admin.token, body: { status: s } })).status).toBe(200);
    }
    expect(await invoices()).toBe(1); // legacy double-posted on PROCESSING → CONFIRMED
    expect(await stock()).toBe(stockAtConfirm);

    const cancel = await api(`/api/orders/${orderId}/status`, { method: 'PUT', token: admin.token, body: { status: 'CANCELLED', rejectedReason: 'Client changed mind' } });
    expect(cancel.json.message).toBe('Order status updated to CANCELLED');
    expect(await stock()).toBe(stockAtConfirm + 10); // legacy did not restore stock from DELIVERED
    expect(await db.clientLedgerEntry.count({ where: { orderId, entryType: 'REVERSAL' } })).toBe(1);
    const c = await db.client.findUnique({ where: { id: client.id } });
    expect(Number(c!.currentOutstanding)).toBe(Math.max(0, outstandingBefore + 2788 - 7788));

    // Salesperson is notified of the status change.
    const notes = await api('/api/notifications', { token: vishal.token });
    expect(notes.json.data.some((n: any) => n.title === 'Order Status Updated')).toBe(true);
  });

  it('honours manager_order_approval_required', async () => {
    const set = (v: string) => api('/api/settings', { method: 'PUT', token: admin.token, body: { settings: [{ key: 'manager_order_approval_required', value: v }] } });
    await set('true');
    try {
      const r = await api('/api/orders', { token: vishal.token, body: { clientId: client.id, items: [{ productId: products['SAM-CBL-02'].id, quantity: 1 }] } });
      expect(r.json.data.status).toBe('SUBMITTED');
      expect(await db.clientLedgerEntry.count({ where: { orderId: r.json.data.id } })).toBe(0);
      await api(`/api/orders/${r.json.data.id}/status`, { method: 'PUT', token: admin.token, body: { status: 'CONFIRMED' } });
      expect(await db.clientLedgerEntry.count({ where: { orderId: r.json.data.id, entryType: 'INVOICE' } })).toBe(1);
      const row = await db.order.findUnique({ where: { id: r.json.data.id } });
      expect(row?.approvedById).toBe(admin.user.id);
    } finally {
      await set('false');
    }
  });

  it('ends the day with a summary computed from accepted GPS points', async () => {
    const r = await api('/api/attendance/end', { token: vishal.token, body: { latitude: 13.3409, longitude: 74.7421 } });
    expect(r.status).toBe(200);
    const s = r.json.data;
    expect(s.ordersCount).toBeGreaterThanOrEqual(2);
    expect(s.clientsVisited).toBe(2);
    // ~45 m between the two accepted points; the 1,000 km flagged jump is excluded.
    expect(s.distanceKm).toBeLessThan(1);
    const sp = await db.salesperson.findUnique({ where: { id: vishal.user.salespersonId } });
    expect(sp?.status).toBe('OFF_DUTY');
    expect((await api('/api/attendance/end', { token: vishal.token, body: {} })).status).toBe(400);
  });

  it('a second shift on the same day merges into the day record instead of crashing', async () => {
    expect((await api('/api/attendance/start', { token: vishal.token, body: {} })).status).toBe(201);
    const r = await api('/api/attendance/end', { token: vishal.token, body: {} });
    expect(r.status).toBe(200);
    const rows = await db.attendance.findMany({ where: { salespersonId: vishal.user.salespersonId } });
    expect(rows.filter((a) => a.status === 'COMPLETED')).toHaveLength(1);
    expect(rows.filter((a) => a.status === 'ON_DUTY')).toHaveLength(0);
    const sessions = await db.locationSession.count({ where: { attendanceId: rows[0].id } });
    expect(sessions).toBe(2);
  });

  it('route history returns segments, events and distance for the day', async () => {
    const r = await api(`/api/location/history?salespersonId=${vishal.user.salespersonId}`, { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.json.pointsCount).toBeGreaterThanOrEqual(4);
    expect(r.json.rejectedPointsCount).toBeGreaterThanOrEqual(1);
    expect(r.json.events.visits).toHaveLength(2);
    expect(r.json.events.orders.length).toBeGreaterThanOrEqual(2);
    expect(r.json.events.payments).toHaveLength(1);
    expect(r.json.attendance.status).toBe('COMPLETED');
  });
});

describe('client & catalogue management', () => {
  it('admin creates a client with opening balance ledger entry, then reassigns it keeping history', async () => {
    const admin = await login('admin@erp.com');
    const sps = (await api('/api/salespersons', { token: admin.token })).json.data;
    const rahul = sps.find((s: any) => s.employeeCode === 'EMP-001');
    const ahmed = sps.find((s: any) => s.employeeCode === 'EMP-002');
    const r = await api('/api/clients', {
      token: admin.token,
      body: {
        name: `Test Retail ${uid()}`,
        contactPerson: 'Asha',
        phone: '9000000001',
        address: '1 MG Road',
        city: 'Mangalore',
        state: 'Karnataka',
        pincode: '575001',
        latitude: 12.87,
        longitude: 74.84,
        openingBalance: 1500,
        assignedSalespersonId: rahul.id,
      },
    });
    expect(r.status).toBe(201);
    const id = r.json.data.id;
    expect(await db.clientLedgerEntry.count({ where: { clientId: id, entryType: 'OPENING_BALANCE' } })).toBe(1);

    expect((await api(`/api/clients/${id}/assign`, { token: admin.token, body: { primarySalespersonId: ahmed.id, backupSalespersonId: rahul.id } })).status).toBe(200);
    const assignments = await db.clientAssignment.findMany({ where: { clientId: id } });
    expect(assignments).toHaveLength(3);
    expect(assignments.filter((a) => a.active)).toHaveLength(2);

    const invalid = await api('/api/clients', { token: admin.token, body: { name: 'X' } });
    expect(invalid.status).toBe(400);
    expect(invalid.json.details.length).toBeGreaterThan(0);
  });

  it('manager creates products and categories; duplicate SKU is a 409', async () => {
    const mgr = await login('manager@erp.com');
    const cat = await api('/api/products/meta/categories', { token: mgr.token, body: { name: `Cat ${uid()}` } });
    expect(cat.status).toBe(201);
    const sku = `SKU-${uid()}`;
    const body = { sku, name: 'Test Cable', categoryId: cat.json.data.id, sellingPrice: 99.5, mrp: 120 };
    expect((await api('/api/products', { token: mgr.token, body })).status).toBe(201);
    expect((await api('/api/products', { token: mgr.token, body })).status).toBe(409);
    const list = await api(`/api/products?search=${sku}`, { token: mgr.token });
    expect(list.json.data[0]).toMatchObject({ sku, sellingPrice: 99.5, taxRate: 18 });
  });

  it('admin creates a salesperson who can then log in', async () => {
    const admin = await login('admin@erp.com');
    const tag = uid().replace(/[^a-z0-9]/gi, '');
    const r = await api('/api/salespersons', {
      token: admin.token,
      body: { name: 'New Rep', email: `rep${tag}@erp.com`, phone: `8${String(Date.now()).slice(-9)}`, password: 'Welcome@2026', employeeCode: `EMP-${tag}`, territory: 'Udupi' },
    });
    expect(r.status).toBe(201);
    const l = await api('/api/auth/login', { body: { identifier: `EMP-${tag}`, password: 'Welcome@2026' } });
    expect(l.status).toBe(200);
    expect(l.json.user.role).toBe('SALESPERSON');
  });
});
