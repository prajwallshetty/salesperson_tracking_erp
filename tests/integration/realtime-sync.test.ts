import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { api, login, BASE, uid, type Session } from './helpers';

/**
 * Business-data synchronisation over Socket.IO: committed changes reach exactly the users who may
 * see them (same company, right role/team), and nobody else.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });
const GX = 'GlobexPass123!';

const EVENTS = ['product:changed', 'client:changed', 'client:assigned', 'settings:changed', 'team:changed', 'permissions:changed', 'attendance:changed', 'order:created'];

class Listener {
  readonly seen: { event: string; data: any }[] = [];
  private constructor(readonly socket: Socket) {
    for (const e of EVENTS) socket.on(e, (env) => this.seen.push({ event: e, data: env.data }));
  }
  static async connect(token: string) {
    const s = await new Promise<Socket>((resolve, reject) => {
      const sock = io(BASE(), { transports: ['websocket'], reconnection: false, timeout: 5000, auth: { token } });
      sock.on('connect', () => resolve(sock));
      sock.on('connect_error', reject);
    });
    return new Listener(s);
  }
  count(event: string) {
    return this.seen.filter((e) => e.event === event).length;
  }
  of(event: string) {
    return this.seen.filter((e) => e.event === event).map((e) => e.data);
  }
  async waitFor(event: string, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.count(event)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }
  close() {
    this.socket.close();
  }
}
const quiet = (ms = 700) => new Promise((r) => setTimeout(r, ms));

describe('real-time synchronisation of business data', () => {
  let aAdmin: Session, aRahul: Session, aVishal: Session;
  let gAdmin: Session, gManager: Session, gGita: Session, gHari: Session;
  const open: Listener[] = [];
  const listen = async (s: Session) => {
    const l = await Listener.connect(s.token);
    open.push(l);
    return l;
  };

  beforeAll(async () => {
    [aAdmin, aRahul, aVishal, gAdmin, gManager, gGita, gHari] = await Promise.all([
      login('admin@erp.com'),
      login('rahul@erp.com'),
      login('vishal@erp.com'),
      login('admin@erp.com', GX, 'globex'),
      login('manager@erp.com', GX, 'globex'),
      login('rahul@erp.com', GX, 'globex'),
      login('hari@globex.test', GX, 'globex'),
    ]);
  });
  afterAll(async () => {
    open.forEach((l) => l.close());
    await db.$disconnect();
  });

  it('a new product reaches every signed-in user of that company (mobile catalogue), and no other company', async () => {
    const [admin, rahul, vishal, gita] = await Promise.all([listen(aAdmin), listen(aRahul), listen(aVishal), listen(gGita)]);
    const cat = ((await api('/api/products/meta/categories', { token: aAdmin.token })).json.data as any[])[0];
    const sku = `RT-${uid().slice(-6)}`;
    const r = await api('/api/products', { token: aAdmin.token, body: { sku, name: 'Realtime Widget', categoryId: cat.id, brand: 'X', unit: 'PCS', sellingPrice: 10, mrp: 12, taxRate: 18, stock: 3 } });
    expect(r.status).toBe(201);
    expect(await rahul.waitFor('product:changed')).toBe(true);
    expect(await vishal.waitFor('product:changed')).toBe(true);
    expect(await admin.waitFor('product:changed')).toBe(true);
    expect(rahul.of('product:changed')[0]).toMatchObject({ id: r.json.data.id, action: 'created' });
    await quiet();
    expect(gita.count('product:changed')).toBe(0);
    // …and the catalogue they refetch really contains it (and the other company's does not).
    expect(((await api('/api/products?limit=500', { token: aRahul.token })).json.data as any[]).some((p) => p.sku === sku)).toBe(true);
    expect(((await api('/api/products?limit=500', { token: gGita.token })).json.data as any[]).some((p) => p.sku === sku)).toBe(false);
    const cr = await api('/api/products/meta/categories', { token: aAdmin.token, body: { name: `RT cat ${uid().slice(-5)}` } });
    expect(cr.status).toBe(201);
    expect(await rahul.waitFor('product:changed')).toBe(true);
    expect(rahul.count('product:changed')).toBe(2);
  });

  it('settings changes reach the company’s field staff immediately and are enforced from then on', async () => {
    const [rahul, gita] = await Promise.all([listen(aRahul), listen(gGita)]);
    const put = await api('/api/settings', { method: 'PUT', token: aAdmin.token, body: { settings: [{ key: 'visit_radius_meters', value: '100' }] } });
    expect(put.status).toBe(200);
    expect(await rahul.waitFor('settings:changed')).toBe(true);
    expect(rahul.of('settings:changed')[0].keys).toEqual(['visit_radius_meters']);
    await quiet();
    expect(gita.count('settings:changed')).toBe(0);
    expect(((await api('/api/settings', { token: aRahul.token })).json.data as any[]).find((s) => s.key === 'visit_radius_meters').value).toBe('100');
  });

  it('reassigning a client updates the new holders AND the previous holder (their list must shrink)', async () => {
    const sps = (await api('/api/salespersons', { token: aAdmin.token })).json.data as any[];
    const rahulSp = sps.find((s) => s.employeeCode === 'EMP-001').id;
    const vishalSp = sps.find((s) => s.employeeCode === 'EMP-003').id;
    const ahmedSp = sps.find((s) => s.employeeCode === 'EMP-002').id;
    const rahulClients = (await api('/api/clients?limit=500', { token: aRahul.token })).json.data as any[];
    const client = rahulClients[rahulClients.length - 1];
    const [rahul, vishal, admin, gita] = await Promise.all([listen(aRahul), listen(aVishal), listen(aAdmin), listen(gGita)]);
    try {
      const r = await api(`/api/clients/${client.id}/assign`, { token: aAdmin.token, body: { primarySalespersonId: vishalSp, backupSalespersonId: ahmedSp } });
      expect(r.status).toBe(200);
      expect(await vishal.waitFor('client:assigned')).toBe(true);
      expect(await rahul.waitFor('client:assigned')).toBe(true);
      const types = (l: Listener) => l.of('client:assigned').map((e) => e.assignment.type);
      expect(types(vishal)).toContain('PRIMARY');
      expect(types(rahul)).toContain('REMOVED');
      await quiet();
      expect(gita.count('client:assigned')).toBe(0);
      // What each phone refetches is now correct.
      expect(((await api('/api/clients?limit=500', { token: aRahul.token })).json.data as any[]).some((c) => c.id === client.id)).toBe(false);
      expect(((await api('/api/clients?limit=500', { token: aVishal.token })).json.data as any[]).some((c) => c.id === client.id)).toBe(true);
      expect(admin.count('client:assigned')).toBeGreaterThan(0);
    } finally {
      await api(`/api/clients/${client.id}/assign`, { token: aAdmin.token, body: { primarySalespersonId: rahulSp } });
    }
  });

  it('a new client is announced company-wide; its creation is stamped with the creator’s company', async () => {
    const [rahul, gita, gAdminL] = await Promise.all([listen(aRahul), listen(gGita), listen(gAdmin)]);
    const name = `RT Client ${uid().slice(-5)}`;
    const r = await api('/api/clients', { token: aAdmin.token, body: { name, contactPerson: 'Contact', phone: `91${Date.now().toString().slice(-8)}`, address: '12 Test Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', latitude: 12.9, longitude: 77.6 } });
    expect({ status: r.status, error: r.json.error, details: r.json.details }).toMatchObject({ status: 201 });
    expect(await rahul.waitFor('client:changed')).toBe(true);
    await quiet();
    expect(gita.count('client:changed') + gAdminL.count('client:changed')).toBe(0);
  });

  it('a manager’s already-open session follows a newly added team member at once, without reconnecting', async () => {
    const mgr = await listen(gManager);
    const admin = await listen(gAdmin);
    const tag = uid().replace(/\D/g, '').slice(-7);
    const create = await api('/api/salespersons', {
      token: gAdmin.token,
      body: { name: `Zed ${tag}`, email: `zed${tag}@globex.test`, phone: `88${tag}`, password: 'ZedPass1234', employeeCode: `ZED-${tag}`, territory: 'Globex North', managerId: gManager.user.id },
    });
    expect(create.status).toBe(201);
    expect(await mgr.waitFor('team:changed')).toBe(true);
    expect(await admin.waitFor('team:changed')).toBe(true);

    // The new salesperson starts the day: the manager (connected BEFORE they existed) hears about it.
    const zed = await login(`zed${tag}@globex.test`, 'ZedPass1234', 'globex');
    const before = mgr.count('attendance:changed');
    expect((await api('/api/attendance/start', { token: zed.token, body: { latitude: 18.5, longitude: 73.8 } })).status).toBe(201);
    expect(await mgr.waitFor('attendance:changed')).toBe(true);
    expect(mgr.count('attendance:changed')).toBeGreaterThan(before);
    expect((await api('/api/attendance/end', { token: zed.token, body: {} })).status).toBe(200);
    // Salespeople outside the manager's team never reach the manager.
    const hariStart = mgr.count('attendance:changed');
    await api('/api/attendance/start', { token: gHari.token, body: { latitude: 18.5, longitude: 73.8 } });
    await quiet(900);
    expect(mgr.count('attendance:changed')).toBe(hariStart);
    await api('/api/attendance/end', { token: gHari.token, body: {} });
  });

  it('changing a manager’s permissions notifies only that manager, and the server enforces it immediately', async () => {
    const [mgr, other, admin] = await Promise.all([listen(gManager), listen(gGita), listen(gAdmin)]);
    expect((await api('/api/settings/permissions/' + gManager.user.id, { method: 'PUT', token: gAdmin.token, body: { canViewGps: false } })).status).toBe(200);
    expect(await mgr.waitFor('permissions:changed')).toBe(true);
    await quiet();
    expect(other.count('permissions:changed') + admin.count('permissions:changed')).toBe(0);
    expect((await api('/api/salespersons/live-status', { token: gManager.token })).status).toBe(403);
    expect((await api('/api/settings/permissions/' + gManager.user.id, { method: 'PUT', token: gAdmin.token, body: { canViewGps: true } })).status).toBe(200);
    expect((await api('/api/salespersons/live-status', { token: gManager.token })).status).toBe(200);
  });
});
