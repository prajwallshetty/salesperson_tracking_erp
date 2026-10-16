import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { getExpenseForUser, updateExpense } from '@/features/expenses/service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ id: string }>({}, async ({ user, params }) => json({ data: await getExpenseForUser(user, params.id) }));

export const PUT = authedRoute<{ id: string }>({}, async (ctx) => {
  const r = await updateExpense(ctx.user, ctx.params.id, await readJson(ctx.req));
  return json(r.body, r.status);
});
