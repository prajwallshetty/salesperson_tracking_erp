import { describe, it, expect, beforeAll } from 'vitest';
import { api, login, type Session } from './helpers';

/**
 * Role, team and record-level isolation. Several of these were exploitable in the legacy API
 * (see docs/MIGRATION_AUDIT.md §4).
 */
describe('authorization & data isolation', () => {
  let admin: Session, manager: Session, rahul: Session, ahmed: Session, vishal: Session;
  let ids: Record<string, string>;

  beforeAll(async () => {
    [admin, manager, rahul, ahmed, vishal] = await Promise.all(
      ['admin@erp.com', 'manager@erp.com', 'rahul@erp.com', 'ahmed@erp.com', 'vishal@erp.com'].map((e) => login(e))
    );
    ids = { rahul: rahul.user.salespersonId, ahmed: ahmed.user.salespersonId, vishal: vishal.user.salespersonId };
  });

  it('salesperson sees only their own assigned clients', async () => {
    const r = await api('/api/clients?limit=500', { token: rahul.token });
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBeGreaterThan(0);
    for (const c of r.json.data) {
      const assigned = [c.primarySalesperson?.id, c.backupSalesperson?.id];
      expect(assigned).toContain(ids.rahul);
    }
    const all = await api('/api/clients?limit=500', { token: admin.token });
    expect(all.json.total).toBeGreaterThan(r.json.total);
  });

  it('salesperson cannot open a client assigned to someone else', async () => {
    const vishalClients = await api('/api/clients', { token: vishal.token });
    const ocean = vishalClients.json.data.find((c: any) => c.name === 'Ocean Telecom Udupi');
    expect((await api(`/api/clients/${ocean.id}`, { token: rahul.token })).status).toBe(403);
    expect((await api(`/api/clients/${ocean.id}`, { token: vishal.token })).status).toBe(200);
  });

  it('?salespersonId= can no longer be used to read a colleague’s records (legacy scope bypass)', async () => {
    for (const path of ['/api/orders', '/api/payments', '/api/visits', '/api/attendance/history']) {
      const r = await api(`${path}?salespersonId=${ids.ahmed}`, { token: rahul.token });
      expect(r.status, path).toBe(200);
      expect(r.json.data, path).toEqual([]);
    }
    for (const type of ['sales', 'collections', 'attendance', 'visits']) {
      const r = await api(`/api/reports/${type}?salespersonId=${ids.ahmed}`, { token: rahul.token });
      expect(r.json.data, type).toEqual([]);
    }
    const dash = await api(`/api/salespersons/dashboard?salespersonId=${ids.ahmed}`, { token: rahul.token });
    // Salesperson's own dashboard is returned instead (param ignored for salespersons).
    expect(dash.status).toBe(200);
  });

  it('salesperson cannot read another salesperson’s performance or route history', async () => {
    expect((await api(`/api/salespersons/${ids.ahmed}/performance`, { token: rahul.token })).status).toBe(403);
    expect((await api(`/api/location/history?salespersonId=${ids.ahmed}`, { token: rahul.token })).status).toBe(403);
    expect((await api(`/api/salespersons/${ids.rahul}/performance`, { token: rahul.token })).status).toBe(200);
  });

  it('manager is limited to their team', async () => {
    const team = await api('/api/salespersons', { token: manager.token });
    const teamIds = team.json.data.map((s: any) => s.id).sort();
    expect(teamIds).toEqual([ids.rahul, ids.ahmed].sort());
    expect((await api(`/api/salespersons/${ids.vishal}/performance`, { token: manager.token })).status).toBe(403);
    expect((await api(`/api/location/history?salespersonId=${ids.vishal}`, { token: manager.token })).status).toBe(403);
    const dash = await api(`/api/salespersons/dashboard?salespersonId=${ids.vishal}`, { token: manager.token });
    expect(dash.status).toBe(403);
    const orders = await api(`/api/orders?salespersonId=${ids.vishal}`, { token: manager.token });
    expect(orders.json.data).toEqual([]);
  });

  it('manager dashboard KPIs are scoped to the team (legacy returned global client totals)', async () => {
    const m = await api('/api/dashboard/summary', { token: manager.token });
    const a = await api('/api/dashboard/summary', { token: admin.token });
    expect(m.status).toBe(200);
    expect(m.json.kpis.totalSalespersons).toBe(2);
    expect(a.json.kpis.totalSalespersons).toBeGreaterThanOrEqual(3);
    expect(m.json.kpis.totalClients).toBeLessThan(a.json.kpis.totalClients);
  });

  it('salesperson cannot use admin/manager write endpoints', async () => {
    const forbidden = [
      ['/api/clients', 'POST', { name: 'X' }],
      ['/api/products', 'POST', { sku: 'X' }],
      ['/api/products/meta/categories', 'POST', { name: 'X' }],
      ['/api/salespersons', 'POST', {}],
      ['/api/settings', 'PUT', { settings: [] }],
      ['/api/settings/permissions', 'GET', undefined],
      ['/api/access-codes', 'GET', undefined],
      ['/api/audit-logs', 'GET', undefined],
      ['/api/orders/00000000-0000-0000-0000-000000000000/status', 'PUT', { status: 'CONFIRMED' }],
      ['/api/payments/00000000-0000-0000-0000-000000000000/verify', 'POST', { status: 'VERIFIED' }],
      ['/api/expenses/00000000-0000-0000-0000-000000000000/approve', 'POST', {}],
    ] as const;
    for (const [path, method, body] of forbidden) {
      const r = await api(path, { method, token: rahul.token, body });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it('manager cannot change system settings', async () => {
    expect((await api('/api/settings', { method: 'PUT', token: manager.token, body: { settings: [{ key: 'visit_radius_meters', value: '5000' }] } })).status).toBe(403);
  });

  it('manager permission flags are enforced server-side', async () => {
    const mgrId = manager.user.id;
    const setPerm = (perms: Record<string, boolean>) => api(`/api/settings/permissions/${mgrId}`, { method: 'PUT', token: admin.token, body: perms });
    try {
      expect((await setPerm({ canViewGps: false, canViewReports: false, canExportReports: true })).status).toBe(200);
      expect((await api('/api/location/current', { token: manager.token })).status).toBe(403);
      expect((await api('/api/salespersons/live-status', { token: manager.token })).status).toBe(403);
      expect((await api('/api/reports/sales', { token: manager.token })).status).toBe(403);

      await setPerm({ canViewGps: true, canViewReports: true, canExportReports: false });
      expect((await api('/api/location/current', { token: manager.token })).status).toBe(200);
      expect((await api('/api/reports/sales', { token: manager.token })).status).toBe(200);
      expect((await api('/api/reports/sales?format=csv', { token: manager.token })).status).toBe(403);
    } finally {
      await setPerm({ canViewGps: true, canViewReports: true, canExportReports: true });
    }
  });

  it('permission update ignores non-permission fields (mass assignment)', async () => {
    const r = await api(`/api/settings/permissions/${manager.user.id}`, {
      method: 'PUT',
      token: admin.token,
      body: { canViewDashboard: true, userId: admin.user.id, id: 'hijack' },
    });
    expect(r.status).toBe(200);
    expect(r.json.data.userId).toBe(manager.user.id);
    expect(r.json.data.id).not.toBe('hijack');
  });

  it('notifications are private: another user’s notification cannot be marked read', async () => {
    const mine = await api('/api/notifications', { token: admin.token });
    const adminNote = mine.json.data.find((n: any) => n.recipientId === admin.user.id);
    if (adminNote) {
      expect((await api(`/api/notifications/${adminNote.id}/read`, { method: 'PUT', token: rahul.token })).status).toBe(404);
    }
    const spNotes = await api('/api/notifications', { token: rahul.token });
    for (const n of spNotes.json.data) {
      expect(n.recipientId === rahul.user.id || n.recipientId === null).toBe(true);
    }
  });

  it('salesperson cannot create orders or payments for another salesperson', async () => {
    const products = await api('/api/products', { token: rahul.token });
    const myClients = await api('/api/clients', { token: rahul.token });
    const r = await api('/api/orders', {
      token: rahul.token,
      body: { clientId: myClients.json.data[0].id, salespersonId: ids.vishal, items: [{ productId: products.json.data[0].id, quantity: 1 }] },
    });
    expect(r.status).toBe(201);
    expect(r.json.data.salespersonId).toBe(ids.rahul); // body salespersonId ignored
  });

  it('salesperson cannot order for or visit a client outside their assignments', async () => {
    const vishalClients = await api('/api/clients', { token: vishal.token });
    const ocean = vishalClients.json.data.find((c: any) => c.name === 'Ocean Telecom Udupi');
    const products = await api('/api/products', { token: rahul.token });
    expect((await api('/api/orders', { token: rahul.token, body: { clientId: ocean.id, items: [{ productId: products.json.data[0].id, quantity: 1 }] } })).status).toBe(403);
    expect((await api('/api/visits/start', { token: rahul.token, body: { clientId: ocean.id, latitude: 13.34, longitude: 74.74 } })).status).toBe(403);
    expect((await api('/api/payments', { token: rahul.token, body: { clientId: ocean.id, amount: 10, paymentMethod: 'CASH' } })).status).toBe(403);
  });

  it('manager cannot add a salesperson to another manager’s team', async () => {
    const r = await api('/api/salespersons', {
      token: manager.token,
      body: { name: 'X', email: `x${Date.now()}@erp.com`, phone: `9${Date.now()}`.slice(0, 10), password: 'Password123!', employeeCode: `EMP-X${Date.now()}`, territory: 'T', managerId: admin.user.id },
    });
    expect(r.status).toBe(403);
  });
});
