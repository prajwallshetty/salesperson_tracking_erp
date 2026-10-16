import bcrypt from 'bcryptjs';
import { prisma, UserStatus } from '@/lib/db';
import { loginSchema } from '@/lib/validations/schemas';
import { publicRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { AUTH_LIMIT } from '@/lib/http/rateLimit';
import { logAuditEvent } from '@/lib/services/audit';
import { loginResponse } from '@/lib/auth/loginResponse';

export const dynamic = 'force-dynamic';

export const POST = publicRoute(async (ctx) => {
  const body = await readJson(ctx.req);
  const result = loginSchema.safeParse({ ...body, identifier: body.identifier || body.email || body.phone });
  if (!result.success) return json({ error: result.error.errors[0]?.message || 'Invalid input parameters' }, 400);
  const { identifier, password, deviceId } = result.data;

  // Email, phone, or employee code (legacy lookup).
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }, { salespersonProfile: { employeeCode: identifier } }] },
    include: { salespersonProfile: true },
  });
  if (!user) return json({ error: 'Invalid credentials' }, 401);
  if (user.status !== UserStatus.ACTIVE) return json({ error: 'Account has been deactivated. Contact your administrator.' }, 403);

  const actor = { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent };
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await logAuditEvent({ actor, action: 'LOGIN_FAILED', module: 'AUTH', oldValue: { identifier } });
    return json({ error: 'Invalid credentials' }, 401);
  }

  if (deviceId && user.salespersonProfile) {
    await prisma.salesperson.update({ where: { id: user.salespersonProfile.id }, data: { deviceId } });
  }
  await logAuditEvent({ actor, action: 'LOGIN_SUCCESS', module: 'AUTH', newValue: { role: user.role, email: user.email } });
  return loginResponse(user);
}, { rateLimit: AUTH_LIMIT });
