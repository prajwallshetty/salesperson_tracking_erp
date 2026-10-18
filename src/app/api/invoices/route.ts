import { authedRoute, json } from '@/lib/http/handler';
import { readJson, searchParams } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { createInvoice, listInvoices } from '@/features/billing/invoices';
import { READ_OPTS, parseListQuery } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(READ_OPTS, async ({ req }) => {
  const sp = searchParams(req);
  return json(await listInvoices({ ...parseListQuery(sp), quotationId: sp.get('quotationId') || undefined }));
});

export const POST = authedRoute(READ_OPTS, async (ctx) => json({ data: await createInvoice(ctx.user, await readJson(ctx.req), actorFrom(ctx)) }, 201));
