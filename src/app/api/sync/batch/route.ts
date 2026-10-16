import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { processSyncBatch, syncBatchSchema } from '@/features/sync/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute({}, async (ctx) => {
  const body = await readJson(ctx.req);
  if (!body.items || !Array.isArray(body.items)) return json({ error: 'items array is required' }, 400);
  const { items } = syncBatchSchema.parse(body);
  if (!ctx.user.salespersonId) return json({ error: 'Only salesperson accounts can synchronise field records' }, 403);
  const results = await processSyncBatch(ctx.user, items, actorFrom(ctx));
  return json({ results });
});
