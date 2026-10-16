import { prisma, Role } from '@/lib/db';
import { forbidden, notFound } from '@/lib/http/errors';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import { getIO } from '@/lib/realtime/emitter';
import type { AuthenticatedUser } from '@/lib/permissions';

/**
 * Signs a user out everywhere: bumps users.tokenVersion so every previously issued token
 * (API Bearer and browser cookie) is rejected on its next request, and drops their live sockets.
 * With the Redis adapter configured, sockets on other instances are dropped too.
 */
export async function revokeUserSessions(userId: string, actor: AuditActor, reason: string) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { id: true, tokenVersion: true },
  });
  getIO()?.in(`user:${userId}`).disconnectSockets(true);
  await logAuditEvent({ actor, action: 'REVOKE_SESSIONS', module: 'AUTH', recordId: userId, newValue: { reason } });
  return updated;
}

/** Super admins may end anyone's sessions; managers only those of salespersons on their team. */
export async function assertCanRevokeSessions(actor: AuthenticatedUser, targetUserId: string) {
  if (actor.id === targetUserId || actor.role === Role.SUPER_ADMIN) {
    const exists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!exists) throw notFound('User not found');
    return;
  }
  if (actor.role === Role.MANAGER) {
    const onTeam = await prisma.managerSalesperson.findFirst({
      where: { managerId: actor.id, salesperson: { userId: targetUserId } },
      select: { id: true },
    });
    if (onTeam) return;
  }
  throw forbidden('Unauthorized to end sessions for this user.');
}
