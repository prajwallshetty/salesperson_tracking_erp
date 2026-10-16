import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { endVisit } from '@/features/visits/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>({}, async (ctx) => {
  const r = await endVisit(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
