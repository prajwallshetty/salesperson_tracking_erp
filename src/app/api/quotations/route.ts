import { authedRoute, json } from '@/lib/http/handler';
import { readJson, searchParams } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { createQuotation, listQuotations } from '@/features/billing/quotations';
import { READ_OPTS, parseListQuery } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(READ_OPTS, async ({ req }) => json(await listQuotations(parseListQuery(searchParams(req)))));

export const POST = authedRoute(READ_OPTS, async (ctx) => json({ data: await createQuotation(ctx.user, await readJson(ctx.req), actorFrom(ctx)) }, 201));
