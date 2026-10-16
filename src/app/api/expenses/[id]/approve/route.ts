import { Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { approveExpense } from '@/features/expenses/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>({ roles: [Role.SUPER_ADMIN, Role.MANAGER] }, async (ctx) => {
  const r = await approveExpense(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
