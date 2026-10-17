import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { api, login, type Session } from './helpers';

/**
 * Access-code workflow, end to end against the real server and database:
 * admin issues → employee signs in with company + employee code + code → server-issued session →
 * persistence, expiry, revocation, lockout, and isolation between companies.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });
const GX = 'GlobexPass123!';
const GLOBEX_ID = '00000000-0000-0000-0000-000000000002';

describe('access-code login workflow', () => {
  let admin: Session, gxAdmin: Session, gxManager: Session;
  let vishalSp: any;

  beforeAll(async () => {
    [admin, gxAdmin, gxManager] = await Promise.all([login('admin@erp.com'), login('admin@erp.com', GX, 'globex'), login('manager@erp.com', GX, 'globex')]);
    vishalSp = ((await api('/api/salespersons', { token: admin.token })).json.data as any[]).find((s) => s.employeeCode === 'EMP-003');
  });
  afterAll(() => db.$disconnect());

  const issue = (s: Session, userId: string, expiresInDays?: number) => api('/api/access-codes/generate', { token: s.token, body: { userId, expiresInDays } });
  const codeLogin = (company: string | undefined, identifier: string, accessCode: string, extra: object = {}) =>
    api('/api/auth/access-code-login', { body: { company, identifier, accessCode, ...extra } });

  it('issuing returns the one-time code with the company and employee details to hand over, and stores only a hash', async () => {
    const r = await issue(admin, vishalSp.userId, 30);
    expect(r.status).toBe(201);
    expect(r.json.companyCode).toBe('default');
    expect(r.json.employeeCode).toBe('EMP-003');
    expect(r.json.accessCode).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
    const days = (new Date(r.json.expiresAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    const row = await db.userAccessCode.findUniqueOrThrow({ where: { id: r.json.id } });
    expect(row.codeHash).not.toContain(r.json.accessCode.replace('-', ''));
    expect(row.codeHash).toMatch(/^\$2[aby]\$/); // bcrypt
    expect(row.tenantId).not.toBe(GLOBEX_ID);
    // Listing never exposes the code or hash.
    const listed = JSON.stringify((await api('/api/access-codes', { token: admin.token })).json);
    expect(listed).not.toContain(r.json.accessCode);
    expect(listed).not.toContain(row.codeHash);
  });

  it('the employee signs in with company + employee code (or phone) and gets a server-issued session that persists', async () => {
    const issued = await issue(admin, vishalSp.userId);
    const code = issued.json.accessCode as string;
    for (const id of ['EMP-003', vishalSp.phone]) {
      const r = await codeLogin('default', id, code.toLowerCase()); // case-insensitive entry
      expect(r.status).toBe(200);
      expect(r.json.user).toMatchObject({ role: 'SALESPERSON', employeeCode: 'EMP-003' });
      expect(r.json.tenant.slug).toBe('default');
      const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
      expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/i);
      // The session is identified by the server from its own token — nothing from the request body.
      const me = await api('/api/auth/me', { cookie });
      expect(me.json.user.id).toBe(r.json.user.id);
      expect(me.json.user.role).toBe('SALESPERSON');
      // And is limited to the salesperson role.
      expect((await api('/api/settings', { method: 'PUT', cookie, body: { settings: [] } })).status).toBe(403);
      expect((await api('/api/access-codes', { cookie })).status).toBe(403);
      // Reusable employee credential: the same code signs in again on another device.
    }
    // Role / tenant claims in the request are ignored.
    const spoof = await codeLogin('default', 'EMP-003', code, { role: 'SUPER_ADMIN', tenantId: GLOBEX_ID, userId: admin.user.id });
    expect(spoof.status).toBe(200);
    expect(spoof.json.user.role).toBe('SALESPERSON');
    expect(spoof.json.tenant.slug).toBe('default');
  });

  it('expiry: an expired code is refused and marked EXPIRED', async () => {
    const issued = await issue(admin, vishalSp.userId, 1);
    const code = issued.json.accessCode as string;
    expect((await codeLogin('default', 'EMP-003', code)).status).toBe(200);
    await db.userAccessCode.update({ where: { id: issued.json.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const r = await codeLogin('default', 'EMP-003', code);
    expect(r.status).toBe(401);
    expect(r.json.error).toMatch(/expired/i);
    expect((await db.userAccessCode.findUniqueOrThrow({ where: { id: issued.json.id } })).status).toBe('EXPIRED');
  });

  it('revocation: a revoked or replaced code stops working, and revoking can also end live sessions', async () => {
    const first = await issue(admin, vishalSp.userId);
    const live = await codeLogin('default', 'EMP-003', first.json.accessCode);
    expect(live.status).toBe(200);
    const second = await issue(admin, vishalSp.userId); // issuing a new code revokes the previous one
    expect((await codeLogin('default', 'EMP-003', first.json.accessCode)).status).toBe(401);
    expect((await codeLogin('default', 'EMP-003', second.json.accessCode)).status).toBe(200);

    const rev = await api('/api/access-codes/revoke', { token: admin.token, body: { userId: vishalSp.userId, endSessions: true } });
    expect(rev.status).toBe(200);
    expect((await codeLogin('default', 'EMP-003', second.json.accessCode)).status).toBe(401);
    expect((await api('/api/auth/me', { token: live.json.token })).status).toBe(401); // existing session ended
  });

  it('inactive employees and unknown employees get the same refusal as a wrong code', async () => {
    const issued = await issue(admin, vishalSp.userId);
    const wrong = await codeLogin('default', 'EMP-003', 'ZZZ-ZZZ');
    const unknown = await codeLogin('default', 'EMP-999', 'ZZZ-ZZZ');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe(wrong.json.error);
    await db.user.update({ where: { id: vishalSp.userId }, data: { status: 'INACTIVE' } });
    try {
      const r = await codeLogin('default', 'EMP-003', issued.json.accessCode);
      expect(r.status).toBe(401);
      expect(r.json.error).toBe(wrong.json.error);
    } finally {
      await db.user.update({ where: { id: vishalSp.userId }, data: { status: 'ACTIVE' } });
    }
  });

  it('lockout is per employee and per company: the same employee code elsewhere is unaffected', async () => {
    const gita = ((await api('/api/salespersons', { token: gxAdmin.token })).json.data as any[]).find((s) => s.employeeCode === 'EMP-001');
    const issued = await issue(gxAdmin, gita.userId);
    try {
      for (let i = 0; i < 4; i++) expect((await codeLogin('globex', 'EMP-001', 'WRONG-ONE')).status).toBe(401);
      expect((await codeLogin('globex', 'EMP-001', 'WRONG-ONE')).status).toBe(423);
      expect((await codeLogin('globex', 'EMP-001', issued.json.accessCode)).status).toBe(423); // right code, still locked
      // EMP-001 in the original company is a different person with a different code.
      expect((await codeLogin('default', 'EMP-001', 'RAHUL12345')).status).toBe(200);
    } finally {
      await db.userAccessCode.updateMany({ where: { userId: gita.userId }, data: { failedAttempts: 0, lockedUntil: null } });
    }
    expect((await codeLogin('globex', 'EMP-001', issued.json.accessCode)).status).toBe(200);
    // Restore the seeded demo code the other suites rely on.
    await issue(gxAdmin, gita.userId);
    const { hash } = { hash: (await import('bcryptjs')).hashSync('GLOBEX1234', 10) };
    await db.userAccessCode.updateMany({ where: { userId: gita.userId, status: 'ACTIVE' }, data: { codeHash: hash } });
  });

  it('authorization of issuing and revoking: managers only for their team, never across companies', async () => {
    const hari = ((await api('/api/salespersons', { token: gxAdmin.token })).json.data as any[]).find((s) => s.employeeCode === 'EMP-002');
    // Globex manager manages Gita only (seed), not Hari.
    expect((await issue(gxManager, hari.userId)).status).toBe(403);
    expect((await api('/api/access-codes/revoke', { token: gxManager.token, body: { userId: hari.userId } })).status).toBe(403);
    // A company admin cannot issue for an employee of another company.
    expect((await issue(admin, hari.userId)).status).toBe(404);
    expect((await issue(gxAdmin, vishalSp.userId)).status).toBe(404);
    // Salespersons cannot issue codes.
    const rahul = await login('rahul@erp.com');
    expect((await issue(rahul, vishalSp.userId)).status).toBe(403);
  });
});
