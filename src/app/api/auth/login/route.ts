import bcrypt from 'bcryptjs';
import { prisma, runWithTenant, UserStatus } from '@/lib/db';
import { loginSchema } from '@/lib/validations/schemas';
import { publicRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { AUTH_LIMIT } from '@/lib/http/rateLimit';
import { logAuditEvent } from '@/lib/services/audit';
import { loginResponse } from '@/lib/auth/loginResponse';
import {
  burnPasswordCheck,
  companyRequiredResponse,
  findUserByIdentifier,
  identityThrottled,
  inactiveTenantResponse,
  isTenantUsable,
  resolveLoginTenant,
} from '@/lib/auth/loginTenant';

export const dynamic = 'force-dynamic';

export const POST = publicRoute(async (ctx) => {
  const body = await readJson(ctx.req);
  const result = loginSchema.safeParse({ ...body, identifier: body.identifier || body.email || body.phone });
  if (!result.success) return json({ error: result.error.errors[0]?.message || 'Invalid input parameters' }, 400);
  const { identifier, password, deviceId, remember, company } = result.data;

  const lookup = await resolveLoginTenant(company);
  if (lookup.kind === 'company_required') return companyRequiredResponse();
  if (lookup.kind === 'unknown') {
    await burnPasswordCheck(password);
    return json({ error: 'Invalid credentials' }, 401);
  }
  const tenant = lookup.tenant;

  const throttled = await identityThrottled(tenant.id, identifier);
  if (throttled) return throttled;

  return runWithTenant(tenant.id, async () => {
    const found = await findUserByIdentifier(identifier);
    const actorBase = { ip: ctx.ip, userAgent: ctx.userAgent };
    if (found.kind !== 'user') {
      await burnPasswordCheck(password);
      if (found.kind === 'ambiguous') await logAuditEvent({ actor: actorBase, action: 'LOGIN_AMBIGUOUS_IDENTIFIER', module: 'AUTH', oldValue: { identifier } });
      return json({ error: 'Invalid credentials' }, 401);
    }
    const user = found.user;
    const actor = { userId: user.id, ...actorBase };

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await logAuditEvent({ actor, action: 'LOGIN_FAILED', module: 'AUTH', oldValue: { identifier } });
      return json({ error: 'Invalid credentials' }, 401);
    }
    // Reasons are only revealed after the password is proven.
    if (user.status !== UserStatus.ACTIVE) return json({ error: 'Account has been deactivated. Contact your administrator.' }, 403);
    if (!isTenantUsable(tenant)) {
      await logAuditEvent({ actor, action: 'LOGIN_TENANT_INACTIVE', module: 'AUTH' });
      return inactiveTenantResponse();
    }

    if (deviceId && user.salespersonProfile) {
      await prisma.salesperson.update({ where: { id: user.salespersonProfile.id }, data: { deviceId } });
    }
    await logAuditEvent({ actor, action: 'LOGIN_SUCCESS', module: 'AUTH', newValue: { role: user.role, email: user.email } });
    return loginResponse(user, { remember, tenant });
  });
}, { rateLimit: AUTH_LIMIT });
