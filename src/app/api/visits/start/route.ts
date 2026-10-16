import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { startVisit } from '@/features/visits/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute({}, async (ctx) => {
  const r = await startVisit(ctx.user, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
