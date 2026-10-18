import { z } from 'zod';
import { prismaRoot, runWithTenant, UserStatus } from '@/lib/db';
import { publicRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { AUTH_LIMIT } from '@/lib/http/rateLimit';
import { logAuditEvent } from '@/lib/services/audit';
import { loginResponse } from '@/lib/auth/loginResponse';
import { devQuickLoginEnabled } from '@/lib/auth/devLogin';
import { isTenantUsable } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const ROLE_ORDER = { SUPER_ADMIN: 0, MANAGER: 1, SALESPERSON: 2 } as const;
const notFound = () => json({ error: 'Not found' }, 404);

// Development only, and deliberately cross-company (unscoped client): it lists accounts of every
// company in the LOCAL development database. It cannot run in production (see devQuickLoginEnabled).

/** Accounts offered as one-tap sign-in buttons on the login page. */
export const GET = publicRoute(async () => {
  if (!devQuickLoginEnabled()) return notFound();
  const users = await prismaRoot.user.findMany({
    where: { status: UserStatus.ACTIVE },
    select: { id: true, name: true, role: true, email: true, tenant: { select: { slug: true } }, salespersonProfile: { select: { employeeCode: true } } },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });
  const multi = new Set(users.map((u) => u.tenant.slug)).size > 1;
  const data = users
    .sort((a, b) => a.tenant.slug.localeCompare(b.tenant.slug) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      label: `${multi ? `${u.tenant.slug} · ` : ''}${u.salespersonProfile?.employeeCode || u.email}`,
    }));
  return json({ data });
});

const schema = z.object({ userId: z.string().uuid(), remember: z.boolean().optional() });

/** Issues a normal session for an active user (same cookie, same checks on every later request). */
export const POST = publicRoute(
  async (ctx) => {
    if (!devQuickLoginEnabled()) return notFound();
    const { userId, remember } = schema.parse(await readJson(ctx.req));
    const user = await prismaRoot.user.findUnique({ where: { id: userId }, include: { salespersonProfile: true, tenant: true } });
    if (!user) return json({ error: 'User not found' }, 404);
    if (user.status !== UserStatus.ACTIVE) return json({ error: 'Account has been deactivated. Contact your administrator.' }, 403);
    if (!isTenantUsable(user.tenant)) return json({ error: "Your company's Bharath Interior Decor subscription is not active." }, 403);
    await runWithTenant(user.tenantId, () =>
      logAuditEvent({ actor: { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent }, action: 'DEV_QUICK_LOGIN', module: 'AUTH', newValue: { role: user.role } })
    );
    return loginResponse(user, { remember, tenant: user.tenant });
  },
  { rateLimit: AUTH_LIMIT }
);
