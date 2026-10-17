import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { api, login, BASE, type Session } from './helpers';

/**
 * Phase 2: server-side session revocation (users.tokenVersion), the session-ended redirect,
 * and the `?token=` legacy auth switch.
 */
const SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });

const me = (s: { token?: string; cookie?: string }) => api('/api/auth/me', s).then((r) => r.status);

describe('session revocation', () => {
  let admin: Session, manager: Session;
  beforeAll(async () => {
    [admin, manager] = await Promise.all([login('admin@erp.com'), login('manager@erp.com')]);
  });
  afterAll(() => db.$disconnect());

  it('new tokens carry the session version; legacy tokens without it keep working until a revocation', async () => {
    const s = await login('vishal@erp.com');
    const claims = jwt.decode(s.token) as any;
    const row = await db.user.findUniqueOrThrow({ where: { id: s.user.id } });
    expect(claims.tv).toBe(row.tokenVersion);

    // A token in the exact legacy shape ({ userId, role }) is valid only while tokenVersion is 0.
    const legacy = jwt.sign({ userId: s.user.id, role: 'SALESPERSON' }, SECRET, { expiresIn: '7d' });
    expect(await me({ token: legacy })).toBe(row.tokenVersion === 0 ? 200 : 401);
  });

  it('"sign out of all devices" ends every session, clears the cookie, and allows signing in again', async () => {
    const phone = await login('vishal@erp.com');
    const laptop = await login('vishal@erp.com');
    const before = await db.user.findUniqueOrThrow({ where: { id: phone.user.id } });

    const r = await api('/api/auth/logout-all', { method: 'POST', cookie: laptop.cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/sg_session=;.*Max-Age=0/i);

    expect(await me({ token: phone.token })).toBe(401);
    expect(await me({ cookie: laptop.cookie })).toBe(401);
    expect((await api('/api/auth/refresh', { method: 'POST', token: phone.token })).status).toBe(401);
    const after = await db.user.findUniqueOrThrow({ where: { id: phone.user.id } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    const again = await login('vishal@erp.com');
    expect(await me({ token: again.token })).toBe(200);
    const audit = await db.auditLog.findFirst({ where: { action: 'REVOKE_SESSIONS', recordId: phone.user.id }, orderBy: { createdAt: 'desc' } });
    expect(audit).toBeTruthy();
  });

  it('admins end anyone’s sessions; managers only their team’s; salespersons nobody else’s', async () => {
    const [ahmed, vishal, rahul] = await Promise.all([login('ahmed@erp.com'), login('vishal@erp.com'), login('rahul@erp.com')]);

    expect((await api('/api/auth/sessions/revoke', { token: rahul.token, body: { userId: ahmed.user.id } })).status).toBe(403);
    expect((await api('/api/auth/sessions/revoke', { token: manager.token, body: { userId: vishal.user.id } })).status).toBe(403);
    expect(await me({ token: vishal.token })).toBe(200);
    expect((await api('/api/auth/sessions/revoke', { token: admin.token, body: { userId: 'not-a-uuid' } })).status).toBe(400);

    expect((await api('/api/auth/sessions/revoke', { token: manager.token, body: { userId: ahmed.user.id } })).status).toBe(200);
    expect(await me({ token: ahmed.token })).toBe(401);
    expect(await me({ token: rahul.token })).toBe(200); // teammates unaffected

    expect((await api('/api/auth/sessions/revoke', { token: admin.token, body: { userId: vishal.user.id } })).status).toBe(200);
    expect(await me({ token: vishal.token })).toBe(401);
  });

  it('revoking sessions disconnects the user’s live socket and blocks reconnecting with the old token', async () => {
    const s = await login('vishal@erp.com');
    const socket: Socket = io(BASE(), { transports: ['websocket'], reconnection: false, auth: { token: s.token } });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    const dropped = new Promise<string>((resolve) => socket.on('disconnect', (reason) => resolve(reason)));
    expect((await api('/api/auth/sessions/revoke', { token: admin.token, body: { userId: s.user.id } })).status).toBe(200);
    expect(await dropped).toBe('io server disconnect');

    const retry = io(BASE(), { transports: ['websocket'], reconnection: false, auth: { token: s.token } });
    await expect(
      new Promise((resolve, reject) => {
        retry.on('connect', () => resolve('connected'));
        retry.on('connect_error', (e) => reject(e));
      })
    ).rejects.toThrow(/inactive or revoked/);
    retry.close();
  });

  it('revoking an access code can also end the user’s password sessions', async () => {
    const sps = await api('/api/salespersons', { token: admin.token });
    const ahmedSp = sps.json.data.find((s: any) => s.employeeCode === 'EMP-002');

    const keep = await login('ahmed@erp.com');
    await api('/api/access-codes/generate', { token: admin.token, body: { userId: ahmedSp.userId } });
    const r1 = await api('/api/access-codes/revoke', { token: admin.token, body: { userId: ahmedSp.userId } });
    expect(r1.status).toBe(200);
    expect(r1.json.sessionsEnded).toBe(false);
    expect(await me({ token: keep.token })).toBe(200); // legacy behaviour by default

    await api('/api/access-codes/generate', { token: admin.token, body: { userId: ahmedSp.userId } });
    const r2 = await api('/api/access-codes/revoke', { token: manager.token, body: { userId: ahmedSp.userId, endSessions: true } });
    expect(r2.status).toBe(200);
    expect(r2.json.sessionsEnded).toBe(true);
    expect(await me({ token: keep.token })).toBe(401);
  });
});

describe('pages with a signed but revoked session', () => {
  it('end on the login page with the cookie cleared — no redirect loop', async () => {
    const s = await login('vishal@erp.com');
    await api('/api/auth/logout-all', { method: 'POST', token: s.token });

    const field = await api('/field', { cookie: s.cookie });
    expect(field.status).toBe(307);
    expect(decodeURIComponent(field.headers.get('location') || '')).toContain('/api/auth/session-ended?next=/field');

    const ended = await api('/api/auth/session-ended?next=%2Ffield', { cookie: s.cookie });
    expect(ended.status).toBe(303);
    expect(ended.headers.get('location')).toMatch(/\/login\?expired=1&next=%2Ffield$/);
    expect(ended.headers.get('set-cookie')).toMatch(/sg_session=;.*Max-Age=0/i);

    // Without the cookie, /login renders instead of bouncing back to /field.
    expect((await api('/login?expired=1')).status).toBe(200);
  });

  it('the console layout uses the same exit for a revoked admin-side session', async () => {
    const s = await login('manager@erp.com');
    await api('/api/auth/logout-all', { method: 'POST', token: s.token });
    const r = await api('/dashboard', { cookie: s.cookie });
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toContain('/api/auth/session-ended');
  });

  it('session-ended never redirects off-site', async () => {
    const r = await api('/api/auth/session-ended?next=%2F%2Fevil.example');
    expect(r.headers.get('location')).toMatch(/\/login\?expired=1$/);
  });
});

describe('legacy ?token= authentication', () => {
  it('is disabled by default (tokens in URLs leak through logs and history)', async () => {
    const s = await login('rahul@erp.com');
    expect((await api(`/api/auth/me?token=${s.token}`)).status).toBe(401);
    expect(await me({ token: s.token })).toBe(200);
  });
});
