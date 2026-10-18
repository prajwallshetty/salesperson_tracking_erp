import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { getBusinessProfile, saveBusinessProfile } from '@/features/billing/business';
import { ADMIN_OPTS, READ_OPTS } from '@/features/billing/http';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(READ_OPTS, async () => json({ data: await getBusinessProfile() }));

export const PUT = authedRoute(ADMIN_OPTS, async (ctx) => json({ data: await saveBusinessProfile(await readJson(ctx.req), actorFrom(ctx)) }));
