import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { submitExpense } from '@/features/expenses/service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute<{ id: string }>({}, async (ctx) => {
  const r = await submitExpense(ctx.user, ctx.params.id, (await readJson(ctx.req)).comment);
  return json(r.body, r.status);
});
