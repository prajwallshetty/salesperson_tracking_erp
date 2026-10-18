import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { voidPayment } from '@/features/billing/invoices';
import { FINANCE_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string; paymentId: string }>(FINANCE_OPTS, async (ctx) =>
  json({ data: await voidPayment(ctx.params.id, ctx.params.paymentId, await readJson(ctx.req), ctx.user, actorFrom(ctx)) })
);
