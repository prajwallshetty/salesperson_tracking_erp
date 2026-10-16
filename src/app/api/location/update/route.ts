import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { ingestLocationPoints } from '@/features/tracking/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute({}, async (ctx) => {
  const r = await ingestLocationPoints(ctx.user, await readJson(ctx.req));
  return json({ message: 'Location points received successfully', pointsIngested: r.pointsIngested, ingestedCount: r.ingestedCount });
});
