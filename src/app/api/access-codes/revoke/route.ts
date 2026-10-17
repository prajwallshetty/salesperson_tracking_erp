import { prisma, Role } from '@/lib/db';
import { revokeAccessCodeSchema } from '@/lib/validations/schemas';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { logAuditEvent, actorFrom } from '@/lib/services/audit';
import { revokeUserSessions } from '@/lib/services/sessions';

export const dynamic = 'force-dynamic';

export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER] }, async (ctx) => {
  const { user } = ctx;
  const parsed = revokeAccessCodeSchema.safeParse(await readJson(ctx.req));
  if (!parsed.success || (!parsed.data.codeId && !parsed.data.userId)) return json({ error: 'Valid codeId or userId is required' }, 400);
  const { codeId, userId, endSessions } = parsed.data;

  // Team scope is decided before anything about the target is revealed (no 404-vs-403 probing).
  if (userId && !codeId && user.role === Role.MANAGER) {
    const inTeam = await prisma.managerSalesperson.findFirst({ where: { managerId: user.id, salesperson: { userId } } });
    if (!inTeam) return json({ error: 'Unauthorized to revoke access codes for this user.' }, 403);
  }

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
  if (endSessions) {
    await revokeUserSessions(target.userId, actorFrom(ctx), 'access code revoked');
    return json({ message: 'Access code revoked and all sessions ended', sessionsEnded: true });
  }
  return json({ message: 'Access code revoked successfully', sessionsEnded: false });
});
