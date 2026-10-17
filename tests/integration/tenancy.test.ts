import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { api, login, BASE, uid, type Session } from './helpers';

/**
 * Multi-tenant isolation against the real server and database.
 * Two companies are seeded: `default` (Vikram/Priya/Rahul…) and `globex` (Globex Traders). They
 * deliberately share emails, employee codes, SKUs and category names.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });
const GX = 'GlobexPass123!';
const GLOBEX_ID = '00000000-0000-0000-0000-000000000002';

const connect = (token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(BASE(), { transports: ['websocket'], reconnection: false, timeout: 5000, auth: { token } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const nextEvent = (s: Socket, event: string, ms: number) =>
  new Promise<any | null>((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    s.once(event, (e) => {
      clearTimeout(t);
      resolve(e);
    });
  });

describe('company sign-in', () => {
  afterAll(() => db.$disconnect());

  it('the same email resolves to different people by company code; without one it is refused', async () => {
    const a = await api('/api/auth/login', { body: { company: 'default', identifier: 'rahul@erp.com', password: 'Password123!' } });
    const b = await api('/api/auth/login', { body: { company: 'globex', identifier: 'rahul@erp.com', password: GX } });
    expect(a.json.user.name).toBe('Rahul Sharma');
    expect(a.json.tenant).toEqual({ slug: 'default', name: expect.any(String) });
    expect(b.json.user.name).toBe('Gita Rao');
    expect(b.json.tenant.slug).toBe('globex');
    expect(a.json.user.id).not.toBe(b.json.user.id);

    const none = await api('/api/auth/login', { body: { identifier: 'rahul@erp.com', password: 'Password123!' } });
    expect(none.status).toBe(400);
    expect(none.json.code).toBe('COMPANY_REQUIRED');
    expect((await api('/api/auth/login-config')).json.companyRequired).toBe(true);
  });

  it("another company's password never works, and unknown companies look like wrong passwords", async () => {
    const wrongTenant = await api('/api/auth/login', { body: { company: 'globex', identifier: 'rahul@erp.com', password: 'Password123!' } });
    const unknown = await api('/api/auth/login', { body: { company: 'no-such-co', identifier: 'rahul@erp.com', password: 'Password123!' } });
    const badSlug = await api('/api/auth/login', { body: { company: "x'; DROP TABLE users;--", identifier: 'rahul@erp.com', password: 'Password123!' } });
    for (const r of [wrongTenant, unknown, badSlug]) {
      expect(r.status).toBe(401);
      expect(r.json.error).toBe('Invalid credentials');
    }
  });

  it('access codes are bound to their company and employee, even when employee codes collide', async () => {
    const ok = await api('/api/auth/access-code-login', { body: { company: 'default', identifier: 'EMP-001', accessCode: 'RAHUL12345' } });
    expect(ok.status).toBe(200);
    expect(ok.json.user.name).toBe('Rahul Sharma');
    expect(ok.json.tenant.slug).toBe('default');

    const gx = await api('/api/auth/access-code-login', { body: { company: 'globex', identifier: 'EMP-001', accessCode: 'GLOBEX1234' } });
    expect(gx.status).toBe(200);
    expect(gx.json.user.name).toBe('Gita Rao');

    // Each code is useless in the other company.
    expect((await api('/api/auth/access-code-login', { body: { company: 'globex', identifier: 'EMP-001', accessCode: 'RAHUL12345' } })).status).toBe(401);
    expect((await api('/api/auth/access-code-login', { body: { company: 'default', identifier: 'EMP-001', accessCode: 'GLOBEX1234' } })).status).toBe(401);
    expect((await api('/api/auth/access-code-login', { body: { identifier: 'EMP-001', accessCode: 'RAHUL12345' } })).json.code).toBe('COMPANY_REQUIRED');
  });

  it('an identifier that matches two people inside one company is refused, not guessed', async () => {
    const tag = uid().replace(/\D/g, '').slice(-9).padStart(9, '7');
    const hash = (await api('/api/auth/login', { body: { company: 'default', identifier: 'rahul@erp.com', password: 'wrong' } })) && (await db.user.findFirstOrThrow({ where: { email: 'rahul@erp.com', tenantId: { not: GLOBEX_ID } } })).passwordHash;
    const x = await db.user.create({ data: { name: 'Dup X', email: `dupx-${tag}@t.test`, phone: tag, passwordHash: hash } });
    const y = await db.user.create({
      data: { name: 'Dup Y', email: `dupy-${tag}@t.test`, phone: `8${tag}`, passwordHash: hash, role: 'SALESPERSON', salespersonProfile: { create: { employeeCode: tag, territory: 'T' } } },
    });
    try {
      const r = await api('/api/auth/login', { body: { company: 'default', identifier: tag, password: 'Password123!' } });
      expect(r.status).toBe(401);
      expect(r.json.error).toBe('Invalid credentials');
      expect(await db.auditLog.count({ where: { action: 'LOGIN_AMBIGUOUS_IDENTIFIER' } })).toBeGreaterThan(0);
    } finally {
      await db.user.deleteMany({ where: { id: { in: [x.id, y.id] } } });
    }
  });

  it('a suspended or expired company cannot sign in or use existing sessions; reasons are shown only after valid credentials', async () => {
    const admin = await login('admin@erp.com', GX, 'globex');
    expect((await api('/api/auth/me', { token: admin.token })).status).toBe(200);
    for (const patch of [{ status: 'SUSPENDED' as const }, { activeUntil: new Date(Date.now() - 60_000) }]) {
      await db.tenant.update({ where: { id: GLOBEX_ID }, data: patch });
      try {
        expect((await api('/api/auth/me', { token: admin.token })).status).toBe(401);
        const good = await api('/api/auth/login', { body: { company: 'globex', identifier: 'admin@erp.com', password: GX } });
        expect(good.status).toBe(403);
        expect(good.json.error).toMatch(/subscription/i);
        const bad = await api('/api/auth/login', { body: { company: 'globex', identifier: 'admin@erp.com', password: 'nope-nope' } });
        expect(bad.status).toBe(401); // no information about the subscription without valid credentials
        const code = await api('/api/auth/access-code-login', { body: { company: 'globex', identifier: 'EMP-001', accessCode: 'GLOBEX1234' } });
        expect(code.status).toBe(403);
        // Other companies are unaffected.
        expect((await login('admin@erp.com')).token).toBeTruthy();
      } finally {
        await db.tenant.update({ where: { id: GLOBEX_ID }, data: { status: 'ACTIVE', activeUntil: null } });
      }
    }
    expect((await login('admin@erp.com', GX, 'globex')).token).toBeTruthy();
  });
});

describe('data isolation between companies', () => {
  let A: { admin: Session; manager: Session; rahul: Session };
  let B: { admin: Session; manager: Session; gita: Session; hari: Session };
  let bClient: any, aClient: any, bOrder: any, bProductId: string;

  beforeAll(async () => {
    const [aa, am, ar, ba, bm, bg, bh] = await Promise.all([
      login('admin@erp.com'),
      login('manager@erp.com'),
      login('rahul@erp.com'),
      login('admin@erp.com', GX, 'globex'),
      login('manager@erp.com', GX, 'globex'),
      login('rahul@erp.com', GX, 'globex'),
      login('hari@globex.test', GX, 'globex'),
    ]);
    A = { admin: aa, manager: am, rahul: ar };
    B = { admin: ba, manager: bm, gita: bg, hari: bh };
    bClient = (await api('/api/clients', { token: B.gita.token })).json.data[0];
    aClient = (await api('/api/clients', { token: A.rahul.token })).json.data[0];
    bProductId = (await api('/api/products', { token: B.gita.token })).json.data[0].id;
    const o = await api('/api/orders', { token: B.gita.token, body: { clientId: bClient.id, items: [{ productId: bProductId, quantity: 2 }], idempotencyKey: `gx-${uid()}` } });
    expect(o.status).toBe(201);
    bOrder = o.json.data;
  });

  it('lists only the caller’s own company', async () => {
    const names = (r: any) => (r.json.data as any[]).map((x) => x.name || x.salespersonName || x.user?.name);
    const aClients = await api('/api/clients', { token: A.admin.token });
    const bClients = await api('/api/clients', { token: B.admin.token });
    expect(names(aClients).some((n: string) => /Globex/.test(n))).toBe(false);
    expect(names(bClients).length).toBeGreaterThan(0);
    expect(names(bClients).every((n: string) => /Globex/.test(n))).toBe(true);

    const aSp = names(await api('/api/salespersons', { token: A.admin.token }));
    expect(aSp).not.toContain('Gita Rao');
    expect(names(await api('/api/salespersons', { token: B.admin.token })).sort()).toEqual(['Gita Rao', 'Hari Das']);

    const aProducts = (await api('/api/products', { token: A.admin.token })).json.data as any[];
    expect(aProducts.some((p) => p.name === 'Globex Fast Charger')).toBe(false);
    const bProducts = (await api('/api/products', { token: B.admin.token })).json.data as any[];
    expect(bProducts.map((p) => p.sku)).toEqual(['SAM-CHG-01']);

    const aOrders = (await api('/api/orders', { token: A.admin.token })).json.data as any[];
    expect(aOrders.find((o) => o.id === bOrder.id)).toBeUndefined();
    expect(((await api('/api/orders', { token: B.admin.token })).json.data as any[]).map((o) => o.id)).toContain(bOrder.id);
  });

  it("reading, changing or acting on another company's records by id is 404 for every role", async () => {
    for (const s of [A.admin, A.manager, A.rahul]) {
      expect((await api(`/api/clients/${bClient.id}`, { token: s.token })).status).toBe(404);
      expect((await api(`/api/orders/${bOrder.id}`, { token: s.token })).status).toBe(404);
    }
    // Changes
    expect((await api(`/api/orders/${bOrder.id}/status`, { method: 'PUT', token: A.admin.token, body: { status: 'CANCELLED' } })).status).toBe(404);
    expect((await api(`/api/products/${bProductId}`, { token: A.admin.token })).status).toBe(404);
    expect((await api(`/api/clients/${bClient.id}/assign`, { token: A.admin.token, body: { primarySalespersonId: A.rahul.user.salespersonId } })).status).toBe(404);
    // Creating records that reference the other company: each foreign reference is refused on its own.
    const aProductId = ((await api('/api/products', { token: A.rahul.token })).json.data as any[])[0].id;
    const oneItem = (productId: string) => [{ productId, quantity: 1 }];
    expect((await api('/api/orders', { token: A.rahul.token, body: { clientId: bClient.id, items: oneItem(aProductId) } })).status).toBe(404); // foreign client
    expect((await api('/api/orders', { token: A.rahul.token, body: { clientId: aClient.id, items: oneItem(bProductId) } })).status).toBe(400); // foreign product: "invalid items"
    expect((await api('/api/orders', { token: A.admin.token, body: { clientId: aClient.id, salespersonId: B.gita.user.salespersonId, items: oneItem(aProductId) } })).status).toBe(404); // foreign salesperson
    expect((await api('/api/payments', { token: A.rahul.token, body: { clientId: bClient.id, amount: 10, paymentMethod: 'CASH' } })).status).toBe(404);
    expect((await api('/api/payments', { token: A.admin.token, body: { clientId: aClient.id, salespersonId: B.gita.user.salespersonId, amount: 10, paymentMethod: 'CASH' } })).status).toBe(404);
    // Nothing changed
    const still = await db.order.findUniqueOrThrow({ where: { id: bOrder.id } });
    expect(still.status).not.toBe('CANCELLED');
    expect((await db.client.findUniqueOrThrow({ where: { id: bClient.id } })).name).toMatch(/Globex/);
  });

  it('user administration cannot cross companies (access codes, sessions, permissions)', async () => {
    const gita = B.gita.user;
    expect((await api('/api/access-codes/generate', { token: A.admin.token, body: { userId: gita.id } })).status).toBe(404);
    expect((await api('/api/access-codes/revoke', { token: A.admin.token, body: { userId: gita.id } })).status).toBe(404);
    expect((await api('/api/auth/sessions/revoke', { token: A.admin.token, body: { userId: gita.id } })).status).toBe(404);
    expect((await api(`/api/settings/permissions/${B.manager.user.id}`, { method: 'PUT', token: A.admin.token, body: { canViewGps: false } })).status).toBe(404);
    expect((await api('/api/auth/me', { token: B.gita.token })).status).toBe(200); // untouched
    const codes = (await api('/api/access-codes', { token: A.admin.token })).json.data as any[];
    expect(codes.some((c) => c.userId === gita.id || /Gita/.test(c.userName || ''))).toBe(false);
  });

  it('settings, audit logs, notifications and dashboards are per company', async () => {
    await api('/api/settings', { method: 'PUT', token: B.admin.token, body: { settings: [{ key: 'visit_radius_meters', value: '250' }] } });
    const a = (await api('/api/settings', { token: A.admin.token })).json.data as any[];
    const b = (await api('/api/settings', { token: B.admin.token })).json.data as any[];
    expect(a.find((s) => s.key === 'visit_radius_meters').value).toBe('100');
    expect(b.find((s) => s.key === 'visit_radius_meters').value).toBe('250');
    await api('/api/settings', { method: 'PUT', token: B.admin.token, body: { settings: [{ key: 'visit_radius_meters', value: '100' }] } });

    const aLogs = JSON.stringify((await api('/api/audit-logs?limit=200', { token: A.admin.token })).json);
    expect(aLogs).not.toContain('Globex');
    expect(aLogs).not.toContain(B.admin.user.id);
    const bLogs = JSON.stringify((await api('/api/audit-logs?limit=200', { token: B.admin.token })).json);
    expect(bLogs).toContain(B.admin.user.id);
    expect(bLogs).not.toContain(A.admin.user.id);

    const aSummary = await api('/api/dashboard/summary', { token: A.admin.token });
    const bSummary = await api('/api/dashboard/summary', { token: B.admin.token });
    expect(JSON.stringify(aSummary.json)).not.toContain('Globex');
    expect(JSON.stringify(bSummary.json)).not.toMatch(/Samsung|Mobile Accessories.*Rahul/);
    const aTotals = JSON.stringify(aSummary.json);
    expect(aTotals).not.toContain(bOrder.orderNumber + '-never');
  });

  it('reports only contain the company’s own rows', async () => {
    for (const type of ['sales', 'collections', 'attendance', 'expenses', 'product-sales']) {
      const a = await api(`/api/reports/${type}`, { token: A.admin.token });
      if (a.status === 200) expect(JSON.stringify(a.json)).not.toMatch(/Globex|Gita Rao|Hari Das/);
    }
  });

  it('SKU, employee code, email, category and document numbers repeat across companies without clashing', async () => {
    // Same SKU already exists in both companies; a SKU that exists only in A can be created in B.
    const sku = `ISO-${uid().slice(-6)}`;
    const mk = (s: Session, price: number) => api('/api/products', { token: s.token, body: { sku, name: `Iso ${price}`, categoryId: undefined, brand: 'X', sellingPrice: price, mrp: price + 10, stock: 5 } });
    const cats = async (s: Session) => ((await api('/api/products/meta/categories', { token: s.token })).json.data as any[])[0].id;
    const body = (catId: string, price: number) => ({ sku, name: `Iso ${price}`, categoryId: catId, brand: 'X', unit: 'PCS', sellingPrice: price, mrp: price + 10, taxRate: 18, stock: 5 });
    const a = await api('/api/products', { token: A.admin.token, body: body(await cats(A.admin), 100) });
    const b = await api('/api/products', { token: B.admin.token, body: body(await cats(B.admin), 200) });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await api('/api/products', { token: B.admin.token, body: body(await cats(B.admin), 300) })).status).toBe(409); // duplicate inside one company still refused
    void mk;

    // Document numbers are per company: Globex's first order is ORD-<year>-000001, the same number
    // the original company's first order has — legal only because the key is (company, number).
    expect(bOrder.orderNumber).toMatch(/^ORD-\d{4}-000001$/);
    const shared = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM (SELECT "orderNumber" FROM orders GROUP BY 1 HAVING count(DISTINCT "tenantId") > 1) x`);
    expect(shared[0].n).toBeGreaterThanOrEqual(1);
  });

  it('a tenant id in the request body, query or headers is ignored', async () => {
    const name = `Probe ${uid()}`;
    const r = await api(`/api/clients?tenantId=${GLOBEX_ID}`, {
      token: A.admin.token,
      headers: { 'X-Tenant-Id': GLOBEX_ID },
      body: { name, contactPerson: 'Probe Person', phone: `91${Date.now().toString().slice(-8)}`, address: '12 Test Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', latitude: 12.9, longitude: 77.6, tenantId: GLOBEX_ID, tenant: { connect: { id: GLOBEX_ID } } },
    });
    expect({ status: r.status, error: r.json.error }).toMatchObject({ status: 201 }); // the request itself is valid; the extra fields are ignored
    const row = await db.client.findFirstOrThrow({ where: { name } });
    expect(row.tenantId).not.toBe(GLOBEX_ID);
    expect(((await api('/api/clients', { token: B.admin.token })).json.data as any[]).some((c) => c.name === name)).toBe(false);
    expect(((await api('/api/clients', { token: A.admin.token })).json.data as any[]).some((c) => c.name === name)).toBe(true);
  });

  it('files, idempotency keys and live events never cross companies', async () => {
    const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'r.png');
    const up = await api('/api/files/upload', { token: B.gita.token, body: fd });
    expect(up.status).toBe(200);
    expect((await api(up.json.url, { token: B.gita.token })).status).toBe(200);
    expect((await api(up.json.url, { token: A.admin.token })).status).toBe(404);
    expect((await api(up.json.url, { token: A.rahul.token })).status).toBe(404);

    // The same idempotency key in two companies must create two independent orders.
    const key = `shared-key-${uid()}`;
    const aProduct = (await api('/api/products', { token: A.rahul.token })).json.data[0];
    const ra = await api('/api/orders', { token: A.rahul.token, body: { clientId: aClient.id, items: [{ productId: aProduct.id, quantity: 1 }], idempotencyKey: key } });
    const rb = await api('/api/orders', { token: B.gita.token, body: { clientId: bClient.id, items: [{ productId: bProductId, quantity: 1 }], idempotencyKey: key } });
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect(rb.json.data.id).not.toBe(ra.json.data.id);
    expect(rb.json.data.clientId).toBe(bClient.id);
  });

  it('live events: a company’s admins receive only their own company’s events, and cannot subscribe to the other’s rooms', async () => {
    const sa = await connect(A.admin.token);
    const sb = await connect(B.admin.token);
    try {
      const gotA = nextEvent(sa, 'order:created', 1500);
      const gotB = nextEvent(sb, 'order:created', 5000);
      const o = await api('/api/orders', { token: B.gita.token, body: { clientId: bClient.id, items: [{ productId: bProductId, quantity: 1 }], idempotencyKey: `ev-${uid()}` } });
      expect(o.status).toBe(201);
      const evB = await gotB;
      expect(evB?.data?.id).toBe(o.json.data.id);
      expect(await gotA).toBeNull();

      // Subscription attempts across the boundary are refused.
      const refusals: string[] = [];
      sa.on('error', (e: any) => refusals.push(e.room));
      const joined: string[] = [];
      sa.on('subscribed:room', (e: any) => joined.push(e.room));
      const bSp = B.gita.user.salespersonId;
      for (const room of [`team:${bSp}`, `salesperson:${bSp}`, `admins:${GLOBEX_ID}`, `managers:${GLOBEX_ID}`, `tenant:${GLOBEX_ID}`, `user:${B.admin.user.id}`, 'admins']) {
        sa.emit('subscribe:room', { room });
      }
      await new Promise((r) => setTimeout(r, 800));
      expect(joined).toEqual([]);
      expect(refusals.length).toBe(7);

      // Within their own company a super admin may follow any salesperson.
      const ownJoin = nextEvent(sa, 'subscribed:room', 5000);
      sa.emit('subscribe:room', { room: `team:${A.rahul.user.salespersonId}` });
      expect((await ownJoin)?.room).toBe(`team:${A.rahul.user.salespersonId}`);

      // …and a later event for that salesperson reaches the admin of the same company only.
      const aOnly = nextEvent(sa, 'order:created', 4000);
      const bNone = nextEvent(sb, 'order:created', 1200);
      const aProduct = (await api('/api/products', { token: A.rahul.token })).json.data[0];
      await api('/api/orders', { token: A.rahul.token, body: { clientId: aClient.id, items: [{ productId: aProduct.id, quantity: 1 }], idempotencyKey: `ev2-${uid()}` } });
      expect(await aOnly).not.toBeNull();
      expect(await bNone).toBeNull();
    } finally {
      sa.close();
      sb.close();
    }
  });

  it('database-level consistency: no row references a parent of another company', async () => {
    const checks: Record<string, string> = {
      'orders↔clients': `SELECT count(*)::int n FROM orders o JOIN clients c ON c.id=o."clientId" WHERE o."tenantId" <> c."tenantId"`,
      'orders↔salespersons': `SELECT count(*)::int n FROM orders o JOIN salespersons s ON s.id=o."salespersonId" WHERE o."tenantId" <> s."tenantId"`,
      'payments↔clients': `SELECT count(*)::int n FROM payments p JOIN clients c ON c.id=p."clientId" WHERE p."tenantId" <> c."tenantId"`,
      'payments↔salespersons': `SELECT count(*)::int n FROM payments p JOIN salespersons s ON s.id=p."salespersonId" WHERE p."tenantId" <> s."tenantId"`,
      'order items↔products': `SELECT count(*)::int n FROM order_items i JOIN orders o ON o.id=i."orderId" JOIN products p ON p.id=i."productId" WHERE o."tenantId" <> p."tenantId"`,
      'products↔categories': `SELECT count(*)::int n FROM products p JOIN categories c ON c.id=p."categoryId" WHERE p."tenantId" <> c."tenantId"`,
      'salespersons↔users': `SELECT count(*)::int n FROM salespersons s JOIN users u ON u.id=s."userId" WHERE s."tenantId" <> u."tenantId"`,
      'visits↔clients': `SELECT count(*)::int n FROM client_visits v JOIN clients c ON c.id=v."clientId" WHERE v."tenantId" <> c."tenantId"`,
      'attendance↔salespersons': `SELECT count(*)::int n FROM attendance a JOIN salespersons s ON s.id=a."salespersonId" WHERE a."tenantId" <> s."tenantId"`,
      'points↔sessions': `SELECT count(*)::int n FROM location_points p JOIN location_sessions s ON s.id=p."sessionId" WHERE p."tenantId" <> s."tenantId"`,
      'assignments↔clients↔salespersons': `SELECT count(*)::int n FROM client_assignments a JOIN clients c ON c.id=a."clientId" JOIN salespersons s ON s.id=a."salespersonId" WHERE c."tenantId" <> s."tenantId"`,
      'access codes↔users': `SELECT count(*)::int n FROM user_access_codes k JOIN users u ON u.id=k."userId" WHERE k."tenantId" <> u."tenantId"`,
      'manager teams': `SELECT count(*)::int n FROM manager_salespersons m JOIN users u ON u.id=m."managerId" JOIN salespersons s ON s.id=m."salespersonId" WHERE u."tenantId" <> s."tenantId"`,
      'expenses↔salespersons': `SELECT count(*)::int n FROM expenses e JOIN salespersons s ON s.id=e."salespersonId" WHERE e."tenantId" <> s."tenantId"`,
      'ledger↔clients': `SELECT count(*)::int n FROM client_ledger_entries l JOIN clients c ON c.id=l."clientId" JOIN orders o ON o.id=l."orderId" WHERE c."tenantId" <> o."tenantId"`,
    };
    for (const [name, sql] of Object.entries(checks)) {
      const rows = await db.$queryRawUnsafe<{ n: number }[]>(sql);
      expect({ check: name, mismatches: rows[0].n }).toEqual({ check: name, mismatches: 0 });
    }
    // Every business row has an existing tenant (FK) and the two companies both own data.
    const perTenant = await db.$queryRawUnsafe<{ tenantId: string; n: number }[]>(`SELECT "tenantId", count(*)::int n FROM clients GROUP BY 1`);
    expect(perTenant.length).toBeGreaterThanOrEqual(2);
  });
});
