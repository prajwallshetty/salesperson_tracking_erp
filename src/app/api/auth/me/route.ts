import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ user }) => {
  const sp = user.salespersonId
    ? await prisma.salesperson.findUnique({ where: { id: user.salespersonId }, select: { status: true } })
    : null;
  return json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      salespersonId: user.salespersonId,
      employeeCode: user.employeeCode,
      territory: user.territory,
      dutyStatus: sp?.status,
      permissions: user.permissions,
    },
    tenant: { slug: user.tenantSlug, name: user.tenantName, activeUntil: user.tenantActiveUntil },
  });
});
