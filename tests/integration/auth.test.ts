import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { api, login, type Session } from './helpers';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });

describe('authentication & sessions', () => {
  let admin: Session;

  beforeAll(async () => {
    admin = await login('admin@erp.com');
  });

  it('health endpoint reports database and realtime status', async () => {
    const r = await api('/api/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('healthy');
    expect(r.json.database).toBe('up');
    expect(r.json.features.socketIO).toBe(true);
    expect((await api('/health')).status).toBe(200);
  });

  it('logs in by email, phone and employee code with the legacy response shape', async () => {
    for (const id of ['rahul@erp.com', '9876543212', 'EMP-001']) {
      const r = await api('/api/auth/login', { body: { identifier: id, password: 'Password123!' } });
      expect(r.status).toBe(200);
      expect(r.json.token).toBeTruthy();
      expect(r.json.expiresIn).toBe('7d');
      expect(r.json.user).toMatchObject({ email: 'rahul@erp.com', role: 'SALESPERSON', employeeCode: 'EMP-001' });
      const cookie = r.headers.get('set-cookie') || '';
      expect(cookie).toMatch(/sg_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=lax/i);
    }
  });

  it('accepts the legacy `email` field instead of `identifier`', async () => {
    const r = await api('/api/auth/login', { body: { email: 'admin@erp.com', password: 'Password123!' } });
    expect(r.status).toBe(200);
  });

  it('rejects bad credentials without revealing which part was wrong', async () => {
    const a = await api('/api/auth/login', { body: { identifier: 'admin@erp.com', password: 'wrong-password' } });
    const b = await api('/api/auth/login', { body: { identifier: 'nobody@erp.com', password: 'wrong-password' } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json.error).toBe(b.json.error);
    expect((await api('/api/auth/login', { body: { identifier: 'ab', password: '' } })).status).toBe(400);
  });

  it('authenticates with either the Bearer token or the session cookie', async () => {
    const viaBearer = await api('/api/auth/me', { token: admin.token });
    const viaCookie = await api('/api/auth/me', { cookie: admin.cookie });
    expect(viaBearer.status).toBe(200);
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.json.user.role).toBe('SUPER_ADMIN');
  });

  it('returns manager permissions from /me', async () => {
    const mgr = await login('manager@erp.com');
    const me = await api('/api/auth/me', { token: mgr.token });
    expect(me.json.user.role).toBe('MANAGER');
    expect(me.json.user.permissions.canApproveOrders).toBe(true);
  });

  it('rejects missing, forged and expired tokens', async () => {
    expect((await api('/api/auth/me')).status).toBe(401);
    const forged = jwt.sign({ userId: admin.user.id, role: 'SUPER_ADMIN' }, 'not-the-server-secret');
    expect((await api('/api/auth/me', { token: forged })).status).toBe(401);
    const expired = jwt.sign({ userId: admin.user.id, role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) - 60 }, 'integration-test-secret-0123456789-abcdefghijklmnop');
    expect((await api('/api/auth/me', { token: expired })).status).toBe(401);
  });

  it('ignores a role claim in the token: authority always comes from the database', async () => {
    const rahul = await login('rahul@erp.com');
    const elevated = jwt.sign({ userId: rahul.user.id, role: 'SUPER_ADMIN' }, 'integration-test-secret-0123456789-abcdefghijklmnop');
    const me = await api('/api/auth/me', { token: elevated });
    expect(me.json.user.role).toBe('SALESPERSON');
    expect((await api('/api/settings', { method: 'PUT', token: elevated, body: { settings: [] } })).status).toBe(403);
  });

  it('deactivating a user ends their existing sessions immediately', async () => {
    const s = await login('vishal@erp.com');
    expect((await api('/api/auth/me', { token: s.token })).status).toBe(200);
    await db.user.update({ where: { id: s.user.id }, data: { status: 'INACTIVE' } });
    try {
      expect((await api('/api/auth/me', { token: s.token })).status).toBe(401);
      expect((await api('/api/auth/login', { body: { identifier: 'vishal@erp.com', password: 'Password123!' } })).status).toBe(403);
    } finally {
      await db.user.update({ where: { id: s.user.id }, data: { status: 'ACTIVE' } });
    }
  });

  it('logout clears the session cookie', async () => {
    const s = await login('ahmed@erp.com');
    const r = await api('/api/auth/logout', { method: 'POST', cookie: s.cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/sg_session=;.*Max-Age=0/i);
  });

  it('refresh renews only old-enough tokens', async () => {
    const fresh = await api('/api/auth/refresh', { method: 'POST', token: admin.token });
    expect(fresh.json.refreshed).toBe(false);
    const old = jwt.sign(
      { userId: admin.user.id, role: 'SUPER_ADMIN', iat: Math.floor(Date.now() / 1000) - 7200 },
      'integration-test-secret-0123456789-abcdefghijklmnop',
      { expiresIn: '7d' }
    );
    const r = await api('/api/auth/refresh', { method: 'POST', token: old });
    expect(r.json.refreshed).toBe(true);
    expect(r.headers.get('set-cookie')).toMatch(/sg_session=/);
  });

  it('access-code login works and locks after 5 failed attempts', async () => {
    const ok = await api('/api/auth/access-code-login', { body: { identifier: 'EMP-001', accessCode: 'RAHUL12345' } });
    expect(ok.status).toBe(200);
    expect(ok.json.user.employeeCode).toBe('EMP-001');

    // Issue a fresh code for Ahmed and lock it with bad guesses.
    const sps = await api('/api/salespersons', { token: admin.token });
    const ahmed = sps.json.data.find((s: any) => s.employeeCode === 'EMP-002');
    const gen = await api('/api/access-codes/generate', { token: admin.token, body: { userId: ahmed.userId } });
    expect(gen.status).toBe(201);
    expect(gen.json.accessCode).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);

    for (let i = 0; i < 4; i++) {
      expect((await api('/api/auth/access-code-login', { body: { identifier: 'EMP-002', accessCode: 'WRONG-CODE' } })).status).toBe(401);
    }
    expect((await api('/api/auth/access-code-login', { body: { identifier: 'EMP-002', accessCode: 'WRONG-CODE' } })).status).toBe(423);
    // Even the right code is refused while locked.
    expect((await api('/api/auth/access-code-login', { body: { identifier: 'EMP-002', accessCode: gen.json.accessCode } })).status).toBe(423);

    // Revoking + regenerating clears the lock (new code).
    const gen2 = await api('/api/access-codes/generate', { token: admin.token, body: { userId: ahmed.userId } });
    expect((await api('/api/auth/access-code-login', { body: { identifier: 'EMP-002', accessCode: gen2.json.accessCode } })).status).toBe(200);
  });
});

describe('page protection & role-based redirects (middleware)', () => {
  it('redirects anonymous users to /login with a return path', async () => {
    const r = await api('/dashboard');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toContain('/login?next=%2Fdashboard');
    expect((await api('/field/orders')).headers.get('location')).toContain('/login');
  });

  it('sends each role to its own interface', async () => {
    const sp = await login('rahul@erp.com');
    const admin = await login('admin@erp.com');
    const mgr = await login('manager@erp.com');

    expect((await api('/dashboard', { cookie: sp.cookie })).headers.get('location')).toMatch(/\/field$/);
    expect((await api('/settings', { cookie: sp.cookie })).headers.get('location')).toMatch(/\/field$/);
    expect((await api('/field', { cookie: admin.cookie })).headers.get('location')).toMatch(/\/dashboard$/);
    expect((await api('/settings', { cookie: mgr.cookie })).headers.get('location')).toMatch(/\/dashboard$/);
    expect((await api('/login', { cookie: admin.cookie })).headers.get('location')).toMatch(/\/dashboard$/);
    expect((await api('/', { cookie: sp.cookie })).headers.get('location')).toMatch(/\/field$/);
  });
});
