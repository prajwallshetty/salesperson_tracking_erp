import { prisma, Role, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { getAuthorizedSalespersonIds } from '@/lib/permissions';
import { actorFrom } from '@/lib/services/audit';
import { createSalesperson } from '@/features/users/service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ user }) => {
  const ids = getAuthorizedSalespersonIds(user);
  const where: Prisma.SalespersonWhereInput = ids === undefined ? {} : { id: { in: ids } };

  const salespersons = await prisma.salesperson.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, status: true } },
      _count: { select: { clientAssignments: { where: { active: true } } } },
      managers: { select: { managerId: true, manager: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return json({
    data: salespersons.map((s) => ({
      id: s.id,
      userId: s.userId,
      employeeCode: s.employeeCode,
      name: s.user.name,
      email: s.user.email,
      phone: s.user.phone,
      userStatus: s.user.status,
      territory: s.territory,
      dutyStatus: s.status,
      deviceId: s.deviceId,
      assignedClientsCount: s._count.clientAssignments,
      joiningDate: s.joiningDate,
      managers: s.managers.map((m) => ({ id: m.managerId, name: m.manager.name })),
    })),
  });
});

export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER], managerPermission: 'canManageUsers' }, async (ctx) => {
  const salesperson = await createSalesperson(ctx.user, await readJson(ctx.req), actorFrom(ctx));
  return json({ data: salesperson }, 201);
});
