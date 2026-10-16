import { prisma, Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({ roles: [Role.SUPER_ADMIN] }, async () => {
  const permissions = await prisma.managerPermission.findMany({ include: { user: { select: { id: true, name: true, email: true } } } });
  // Managers without a row yet are listed too, so their (default) permissions can be edited.
  const withRow = new Set(permissions.map((p) => p.userId));
  const managers = await prisma.user.findMany({ where: { role: Role.MANAGER, id: { notIn: [...withRow] } }, select: { id: true, name: true, email: true } });
  return json({ data: permissions, managersWithoutPermissions: managers });
});
