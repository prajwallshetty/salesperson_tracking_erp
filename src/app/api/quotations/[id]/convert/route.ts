import { authedRoute, json } from '@/lib/http/handler';
import { actorFrom } from '@/lib/services/audit';
import { convertQuotationToInvoice } from '@/features/billing/quotations';
import { READ_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

/** Creates the draft invoice for an accepted quotation; repeating the call returns the invoice already created. */
export const POST = authedRoute<{ id: string }>(READ_OPTS, async (ctx) => {
  const r = await convertQuotationToInvoice(ctx.user, ctx.params.id, actorFrom(ctx));
  return json({ data: r.invoice, created: r.created }, r.created ? 201 : 200);
});
