import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { startDay } from '@/features/attendance/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute({}, async (ctx) => {
  const r = await startDay(ctx.user, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
