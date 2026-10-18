import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { cancelInvoice } from '@/features/billing/invoices';
import { FINANCE_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>(FINANCE_OPTS, async (ctx) => json({ data: await cancelInvoice(ctx.user, ctx.params.id, await readJson(ctx.req), actorFrom(ctx)) }));
