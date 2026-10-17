import bcrypt from 'bcryptjs';
import { prisma, runWithTenant, UserStatus } from '@/lib/db';
import { accessCodeLoginSchema } from '@/lib/validations/schemas';
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

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const GENERIC = 'Invalid credentials or access code';

/**
 * Employee access code sign-in. Codes are reusable employee credentials (admin-issued, optional
 * expiry, revocable); this route resolves the company first, then the employee inside it, so a
 * code can never grant access to another company.
 */
export const POST = publicRoute(async (ctx) => {
  const result = accessCodeLoginSchema.safeParse(await readJson(ctx.req));
  if (!result.success) return json({ error: result.error.errors[0]?.message || 'Invalid input parameters' }, 400);
  const { identifier, accessCode, deviceId, remember, company } = result.data;
  const submitted = accessCode.trim().toUpperCase();

  const lookup = await resolveLoginTenant(company);
  if (lookup.kind === 'company_required') return companyRequiredResponse();
  if (lookup.kind === 'unknown') {
    await burnPasswordCheck(submitted);
    return json({ error: GENERIC }, 401);
  }
  const tenant = lookup.tenant;

  const throttled = await identityThrottled(tenant.id, identifier);
  if (throttled) return throttled;

  return runWithTenant(tenant.id, async () => {
    const found = await findUserByIdentifier(identifier);
    const actorBase = { ip: ctx.ip, userAgent: ctx.userAgent };
    // Generic rejection to prevent account enumeration (same response and similar cost).
    if (found.kind !== 'user' || found.user.status !== UserStatus.ACTIVE) {
      await burnPasswordCheck(submitted);
      if (found.kind === 'ambiguous') await logAuditEvent({ actor: actorBase, action: 'ACCESS_CODE_AMBIGUOUS_IDENTIFIER', module: 'AUTH', oldValue: { identifier } });
      return json({ error: GENERIC }, 401);
    }
    const user = found.user;
    const actor = { userId: user.id, ...actorBase };

    const activeCode = await prisma.userAccessCode.findFirst({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    if (!activeCode) {
      await burnPasswordCheck(submitted);
      return json({ error: GENERIC }, 401);
    }

    if (activeCode.lockedUntil && activeCode.lockedUntil > new Date()) {
      const remaining = Math.ceil((activeCode.lockedUntil.getTime() - Date.now()) / 60000);
      return json({ error: `Access code is temporarily locked due to repeated failed attempts. Please try again in ${remaining} minute(s).` }, 423);
    }
    if (activeCode.expiresAt && activeCode.expiresAt < new Date()) {
      await prisma.userAccessCode.update({ where: { id: activeCode.id }, data: { status: 'EXPIRED' } });
      return json({ error: 'Access code has expired. Please contact your manager or administrator.' }, 401);
    }

    // Generated codes are uppercase; the field UI also upper-cases input.
    if (!(await bcrypt.compare(submitted, activeCode.codeHash))) {
      // Atomic increment so parallel guesses cannot dodge the lockout.
      const updated = await prisma.userAccessCode.update({ where: { id: activeCode.id }, data: { failedAttempts: { increment: 1 } } });
      const shouldLock = updated.failedAttempts >= MAX_FAILED_ATTEMPTS;
      if (shouldLock) {
        await prisma.userAccessCode.update({ where: { id: activeCode.id }, data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) } });
      }
      await logAuditEvent({
        actor,
        action: 'ACCESS_CODE_LOGIN_FAILED',
        module: 'AUTH',
        recordId: activeCode.id,
        oldValue: { failedAttempts: updated.failedAttempts, locked: shouldLock },
      });
      if (shouldLock) {
        return json({ error: `Access code is temporarily locked due to repeated failed attempts. Please try again in ${LOCK_MINUTES} minute(s).` }, 423);
      }
      return json({ error: GENERIC }, 401);
    }

    if (!isTenantUsable(tenant)) {
      await logAuditEvent({ actor, action: 'ACCESS_CODE_LOGIN_TENANT_INACTIVE', module: 'AUTH', recordId: activeCode.id });
      return inactiveTenantResponse();
    }

    await prisma.userAccessCode.update({ where: { id: activeCode.id }, data: { failedAttempts: 0, lockedUntil: null, lastUsedAt: new Date() } });
    if (deviceId && user.salespersonProfile) {
      await prisma.salesperson.update({ where: { id: user.salespersonProfile.id }, data: { deviceId } });
    }
    await logAuditEvent({ actor, action: 'ACCESS_CODE_LOGIN_SUCCESS', module: 'AUTH', recordId: activeCode.id, newValue: { role: user.role, method: 'ACCESS_CODE' } });
    return loginResponse(user, { remember, tenant });
  });
}, { rateLimit: AUTH_LIMIT });
