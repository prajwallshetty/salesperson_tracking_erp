import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { listSequences, saveSequence } from '@/features/billing/sequences';
import { ADMIN_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(ADMIN_OPTS, async () => json({ data: await listSequences() }));

export const PUT = authedRoute(ADMIN_OPTS, async (ctx) => json({ data: await saveSequence(await readJson(ctx.req), actorFrom(ctx)) }));
