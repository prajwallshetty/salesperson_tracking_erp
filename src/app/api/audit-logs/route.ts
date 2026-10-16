import { prisma, Role, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { pagination, searchParams } from '@/lib/http/request';
import { parseDateRange } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** Legacy access preserved: SUPER_ADMIN and MANAGER. */
export const GET = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER] }, async ({ req }) => {
  const sp = searchParams(req);
  const { limit, offset } = pagination(sp, { limit: 50, max: 500 });
  const where: Prisma.AuditLogWhereInput = {};
  if (sp.get('module')) where.module = sp.get('module')!;
  if (sp.get('action')) where.action = sp.get('action')!;
  if (sp.get('userId')) where.userId = sp.get('userId')!;
  const range = parseDateRange(sp.get('from'), sp.get('to'));
  if (range) where.createdAt = range;
  const search = sp.get('search');
  if (search) where.OR = ['action', 'module', 'recordId'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' } }));

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { user: { select: { name: true, role: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }),
  ]);

  return json({
    total,
    data: logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      userName: l.user?.name || 'System',
      userRole: l.user?.role || 'SYSTEM',
      action: l.action,
      module: l.module,
      recordId: l.recordId,
      oldValue: l.oldValue,
      newValue: l.newValue,
      ip: l.ip,
      device: l.device,
      createdAt: l.createdAt,
    })),
  });
});
