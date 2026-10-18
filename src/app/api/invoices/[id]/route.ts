import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { deleteInvoice, getInvoice, updateInvoice } from '@/features/billing/invoices';
import { READ_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ id: string }>(READ_OPTS, async ({ params }) => json({ data: await getInvoice(params.id) }));

/** Draft invoices only: an issued invoice's figures are never rewritten. */
export const PUT = authedRoute<{ id: string }>(READ_OPTS, async (ctx) => json({ data: await updateInvoice(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx)) }));

export const DELETE = authedRoute<{ id: string }>(READ_OPTS, async (ctx) => {
  await deleteInvoice(ctx.params.id, actorFrom(ctx));
  return json({ message: 'Draft invoice deleted' });
});
