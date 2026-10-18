import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { deleteQuotation, getQuotation, updateQuotation } from '@/features/billing/quotations';
import { READ_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ id: string }>(READ_OPTS, async ({ params }) => json({ data: await getQuotation(params.id) }));

export const PUT = authedRoute<{ id: string }>(READ_OPTS, async (ctx) => json({ data: await updateQuotation(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx)) }));

export const DELETE = authedRoute<{ id: string }>(READ_OPTS, async (ctx) => {
  await deleteQuotation(ctx.params.id, actorFrom(ctx));
  return json({ message: 'Quotation deleted' });
});
