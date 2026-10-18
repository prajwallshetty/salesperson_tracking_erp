import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { respondToQuotation } from '@/features/billing/quotations';
import { READ_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>(READ_OPTS, async (ctx) => json({ data: await respondToQuotation(ctx.params.id, await readJson(ctx.req), actorFrom(ctx)) }));
