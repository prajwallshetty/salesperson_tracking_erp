import { prisma, Role } from '@/lib/db';
import { revokeAccessCodeSchema } from '@/lib/validations/schemas';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { logAuditEvent, actorFrom } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER] }, async (ctx) => {
  const { user } = ctx;
  const parsed = revokeAccessCodeSchema.safeParse(await readJson(ctx.req));
  if (!parsed.success || (!parsed.data.codeId && !parsed.data.userId)) return json({ error: 'Valid codeId or userId is required' }, 400);
  const { codeId, userId } = parsed.data;

  const target = codeId
    ? await prisma.userAccessCode.findUnique({ where: { id: codeId } })
    : await prisma.userAccessCode.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
  if (!target) return json({ error: 'Active access code not found' }, 404);

  if (user.role === Role.MANAGER) {
    const isAssigned = await prisma.managerSalesperson.findFirst({ where: { managerId: user.id, salesperson: { userId: target.userId } } });
    if (!isAssigned) return json({ error: 'Unauthorized to revoke access codes for this user.' }, 403);
  }

  await prisma.userAccessCode.update({ where: { id: target.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id } });
  await logAuditEvent({ actor: actorFrom(ctx), action: 'REVOKE_ACCESS_CODE', module: 'AUTH', recordId: target.id, newValue: { status: 'REVOKED' } });
  return json({ message: 'Access code revoked successfully' });
});
