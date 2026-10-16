import { prisma, ExpenseStatus, ExpenseCategory, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson, searchParams } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { createExpense, expenseScope, formatExpense } from '@/features/expenses/service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ req, user }) => {
  const sp = searchParams(req);
  const pageNum = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '20', 10) || 20));

  const where: Prisma.ExpenseWhereInput = expenseScope(user, sp.get('salespersonId'));
  const status = sp.get('status');
  if (status && (Object.values(ExpenseStatus) as string[]).includes(status)) where.status = status as ExpenseStatus;
  const category = sp.get('category');
  if (category && (Object.values(ExpenseCategory) as string[]).includes(category)) where.category = category as ExpenseCategory;
  const startDate = sp.get('startDate');
  const endDate = sp.get('endDate');
  if (startDate || endDate) {
    where.expenseDate = {};
    if (startDate && !isNaN(Date.parse(startDate))) where.expenseDate.gte = new Date(startDate);
    if (endDate && !isNaN(Date.parse(endDate))) where.expenseDate.lte = new Date(endDate);
  }

  const [total, expenses, aggregates] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: {
        salesperson: { include: { user: { select: { name: true, email: true, phone: true } } } },
        client: { select: { id: true, name: true, businessName: true } },
        approver: { select: { id: true, name: true } },
        rejecter: { select: { id: true, name: true } },
        reimburser: { select: { id: true, name: true } },
      },
      orderBy: { expenseDate: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.expense.groupBy({ by: ['status'], where, _sum: { amount: true }, _count: { id: true } }),
  ]);

  const summary: Record<string, { count: number; totalAmount: number }> = Object.fromEntries(
    Object.values(ExpenseStatus).map((s) => [s, { count: 0, totalAmount: 0 }])
  );
  for (const a of aggregates) summary[a.status] = { count: a._count.id, totalAmount: a._sum.amount ? parseFloat(a._sum.amount.toString()) : 0 };

  return json({
    data: expenses.map(formatExpense),
    meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    summary,
  });
});

export const POST = authedRoute({}, async (ctx) => {
  const r = await createExpense(ctx.user, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
