import { Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { assignClient } from '@/features/customers/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>({ roles: [Role.SUPER_ADMIN, Role.MANAGER], managerPermission: 'canAssignClients' }, async (ctx) => {
  await assignClient(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx));
  return json({ message: 'Client assignment updated successfully' });
});
