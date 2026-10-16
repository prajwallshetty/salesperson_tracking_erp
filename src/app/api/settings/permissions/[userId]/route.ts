import { z } from 'zod';
import { prisma, Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { MANAGER_PERMISSION_KEYS } from '@/lib/permissions';
import { logAuditEvent, actorFrom } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

// Only the 12 permission flags are writable (legacy passed the raw body into Prisma).
const permsSchema = z.object(Object.fromEntries(MANAGER_PERMISSION_KEYS.map((k) => [k, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>).strip();

export const PUT = authedRoute<{ userId: string }>({ roles: [Role.SUPER_ADMIN] }, async (ctx) => {
  const { userId } = ctx.params;
  const perms = permsSchema.parse(await readJson(ctx.req));
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!target) return json({ error: 'User not found' }, 404);
  if (target.role !== Role.MANAGER) return json({ error: 'Permissions can only be configured for managers' }, 400);

  const updated = await prisma.managerPermission.upsert({ where: { userId }, update: perms, create: { userId, ...perms } });
  await logAuditEvent({ actor: actorFrom(ctx), action: 'UPDATE_MANAGER_PERMISSIONS', module: 'PERMISSIONS', recordId: userId, newValue: perms });
  return json({ data: updated });
});
