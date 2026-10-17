import { describe, it, expect, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { api, login } from './helpers';

/** Quick access login: Remember me, development quick login, Android shell config. */
const SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });
afterAll(() => db.$disconnect());

const lifetime = (token: string) => {
  const c = jwt.decode(token) as any;
  return c.exp - c.iat;
};

describe('Remember me', () => {
  it('off: 12-hour token and a session cookie (no Max-Age / Expires)', async () => {
    const r = await api('/api/auth/login', { body: { company: 'default', identifier: 'rahul@erp.com', password: 'Password123!', remember: false } });
    expect(r.status).toBe(200);
    expect(r.json.expiresIn).toBe('12h');
    expect(r.json.remember).toBe(false);
    expect(lifetime(r.json.token)).toBe(12 * 3600);
    const cookie = r.headers.get('set-cookie') || '';
    expect(cookie).toMatch(/sg_session=/);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('on: 7-day token and a persistent cookie', async () => {
    const r = await api('/api/auth/login', { body: { company: 'default', identifier: 'rahul@erp.com', password: 'Password123!', remember: true } });
    expect(r.json.expiresIn).toBe('7d');
    expect(lifetime(r.json.token)).toBe(7 * 24 * 3600);
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=604800/);
  });

  it('API clients that do not send it keep the legacy 7-day session', async () => {
    const r = await api('/api/auth/login', { body: { company: 'default', identifier: 'rahul@erp.com', password: 'Password123!' } });
    expect(r.json.expiresIn).toBe('7d');
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=604800/);
  });

  it('access-code sign-in honours it too', async () => {
    const r = await api('/api/auth/access-code-login', { body: { company: 'default', identifier: 'EMP-001', accessCode: 'RAHUL12345', remember: false } });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).not.toMatch(/Max-Age/i);
  });

  it('refresh keeps the choice: a non-remembered session stays a 12-hour session cookie', async () => {
    const me = await login('rahul@erp.com');
    const old = jwt.sign({ userId: me.user.id, role: 'SALESPERSON', tv: 0, rm: false, iat: Math.floor(Date.now() / 1000) - 7200 }, SECRET, { expiresIn: '12h' });
    const r = await api('/api/auth/refresh', { method: 'POST', token: old });
    expect(r.json.refreshed).toBe(true);
    expect(r.json.expiresIn).toBe('12h');
    expect(lifetime(r.json.token)).toBe(12 * 3600);
    expect(r.headers.get('set-cookie')).not.toMatch(/Max-Age/i);
  });
});

describe('development quick login (DEV_QUICK_LOGIN=true, NODE_ENV=development in this server)', () => {
  it('lists active accounts without any credential fields', async () => {
    const r = await api('/api/auth/dev-login');
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBeGreaterThan(0);
    expect(r.json.data[0].role).toBe('SUPER_ADMIN');
    expect(r.text).not.toMatch(/password|accessCode|hash/i);
  });

  it('issues a normal, server-checked session and audits it', async () => {
    const list = (await api('/api/auth/dev-login')).json.data;
    const mgr = list.find((u: any) => u.role === 'MANAGER');
    const r = await api('/api/auth/dev-login', { body: { userId: mgr.id, remember: false } });
    expect(r.status).toBe(200);
    expect(r.json.user.role).toBe('MANAGER');
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    expect((await api('/api/auth/me', { cookie })).json.user.id).toBe(mgr.id);
    // Role permissions still apply: a manager cannot change system settings.
    expect((await api('/api/settings', { method: 'PUT', cookie, body: { settings: [] } })).status).toBe(403);
    expect(await db.auditLog.count({ where: { action: 'DEV_QUICK_LOGIN', userId: mgr.id } })).toBeGreaterThan(0);
  });

  it('refuses deactivated users and invalid input', async () => {
    const list = (await api('/api/auth/dev-login')).json.data;
    const sp = list.find((u: any) => u.label.endsWith('EMP-003') && u.label.startsWith('default'));
    await db.user.update({ where: { id: sp.id }, data: { status: 'INACTIVE' } });
    try {
      expect((await api('/api/auth/dev-login', { body: { userId: sp.id } })).status).toBe(403);
    } finally {
      await db.user.update({ where: { id: sp.id }, data: { status: 'ACTIVE' } });
    }
    expect((await api('/api/auth/dev-login', { body: { userId: 'nope' } })).status).toBe(400);
  });

  it('the login page and every script it loads ship no seeded passwords or access codes', async () => {
    const page = await api('/login');
    expect(page.status).toBe(200);
    const scripts = [...page.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const body of [page.text, ...(await Promise.all(scripts.map((src) => api(src).then((r) => r.text))))]) {
      expect(body).not.toContain('Password123!');
      expect(body).not.toContain('RAHUL12345');
    }
  });
});

describe('Android shell configuration', () => {
  it('is public, uncached, and empty unless configured', async () => {
    const r = await api('/api/app/config');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json.android).toEqual({ minBuild: null, latestBuild: null, updateUrl: null });
  });
});
