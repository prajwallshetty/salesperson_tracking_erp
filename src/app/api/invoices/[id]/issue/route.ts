import { authedRoute, json } from '@/lib/http/handler';
import { actorFrom } from '@/lib/services/audit';
import { issueInvoice } from '@/features/billing/invoices';
import { FINANCE_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>(FINANCE_OPTS, async (ctx) => json({ data: await issueInvoice(ctx.user, ctx.params.id, actorFrom(ctx)) }));
