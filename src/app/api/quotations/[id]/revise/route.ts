import { authedRoute, json } from '@/lib/http/handler';
import { actorFrom } from '@/lib/services/audit';
import { reviseQuotation } from '@/features/billing/quotations';
import { READ_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>(READ_OPTS, async (ctx) => json({ data: await reviseQuotation(ctx.params.id, actorFrom(ctx)) }, 201));
