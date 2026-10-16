import { Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { updateOrderStatus } from '@/features/orders/service';

export const dynamic = 'force-dynamic';

export const PUT = authedRoute<{ id: string }>({ roles: [Role.SUPER_ADMIN, Role.MANAGER], managerPermission: 'canApproveOrders' }, async (ctx) => {
  const r = await updateOrderStatus(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
