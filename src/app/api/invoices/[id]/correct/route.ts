import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { correctInvoice } from '@/features/billing/invoices';
import { FINANCE_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

/** Cancels the issued invoice (with a reason) and opens a corrected draft copy; repeating the call returns the copy already open. */
export const POST = authedRoute<{ id: string }>(FINANCE_OPTS, async (ctx) => {
  const r = await correctInvoice(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx));
  return json({ data: r.copy, created: r.created }, r.created ? 201 : 200);
});
