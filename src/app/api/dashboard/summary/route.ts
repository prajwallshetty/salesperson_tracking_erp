import { prisma, Prisma, SalespersonStatus } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { getAuthorizedSalespersonIds } from '@/lib/permissions';
import { clientScopeFilter } from '@/lib/services/access';
import { DEFAULT_TIMEZONE, businessDateString, startOfBusinessDate, startOfBusinessDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({ managerPermission: 'canViewDashboard' }, async ({ user }) => {
  const ids = getAuthorizedSalespersonIds(user);
  const spWhere: Prisma.SalespersonWhereInput = ids === undefined ? {} : { id: { in: ids } };
  const bySp = ids === undefined ? {} : { salespersonId: { in: ids } };
  const clientWhere = clientScopeFilter(user);

  const today = startOfBusinessDay();
  const todayYmd = businessDateString();
  const [y, m, d] = todayYmd.split('-').map(Number);
  const last7Days = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d - 6 + i)).toISOString().slice(0, 10));
  const sevenDaysAgo = startOfBusinessDate(last7Days[0]);

  // Day buckets computed in the business timezone (legacy used UTC dates).
  const sqlIds = ids === undefined ? Prisma.sql`TRUE` : ids.length ? Prisma.sql`"salespersonId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
  const tz = DEFAULT_TIMEZONE;

  const [
    totalSalespersons,
    activeSalespersons,
    totalClients,
    todayOrders,
    todayPayments,
    outstanding,
    salesByDay,
    collectionsByDay,
    topProductsData,
    perfSps,
    perfOrders,
    perfPayments,
  ] = await Promise.all([
    prisma.salesperson.count({ where: spWhere }),
    prisma.salesperson.count({ where: { ...spWhere, status: SalespersonStatus.ON_DUTY } }),
    prisma.client.count({ where: clientWhere }),
    prisma.order.aggregate({ where: { ...bySp, createdAt: { gte: today } }, _sum: { grandTotal: true }, _count: true }),
    prisma.payment.groupBy({ by: ['status'], where: { ...bySp, collectedAt: { gte: today } }, _sum: { amount: true } }),
    prisma.client.aggregate({ where: clientWhere, _sum: { currentOutstanding: true } }),
    prisma.$queryRaw<{ day: string; amount: number }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, SUM("grandTotal")::float AS amount
      FROM "orders" WHERE "createdAt" >= ${sevenDaysAgo} AND ${sqlIds} GROUP BY 1`,
    prisma.$queryRaw<{ day: string; amount: number }[]>`
      SELECT to_char(("collectedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, SUM("amount")::float AS amount
      FROM "payments" WHERE "collectedAt" >= ${sevenDaysAgo} AND "status" = 'VERIFIED' AND ${sqlIds} GROUP BY 1`,
    prisma.orderItem.groupBy({
      by: ['productId', 'productName'],
      where: ids === undefined ? {} : { order: bySp },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    }),
    prisma.salesperson.findMany({ where: spWhere, select: { id: true, territory: true, status: true, user: { select: { name: true } } } }),
    prisma.order.groupBy({ by: ['salespersonId'], where: { ...bySp, createdAt: { gte: sevenDaysAgo } }, _sum: { grandTotal: true }, _count: true }),
    prisma.payment.groupBy({ by: ['salespersonId'], where: { ...bySp, collectedAt: { gte: sevenDaysAgo }, status: 'VERIFIED' }, _sum: { amount: true } }),
  ]);

  const paySum = (s: string) => Number(todayPayments.find((p) => p.status === s)?._sum.amount ?? 0);
  const todayVerifiedCollections = paySum('VERIFIED');
  const todayPendingCollections = paySum('PENDING');
  const toSeries = (rows: { day: string; amount: number }[]) => {
    const map = new Map(rows.map((r) => [r.day, Number(r.amount)]));
    return last7Days.map((date) => ({ date, amount: map.get(date) || 0 }));
  };
  const ordersBySp = new Map(perfOrders.map((o) => [o.salespersonId, o]));
  const paysBySp = new Map(perfPayments.map((p) => [p.salespersonId, Number(p._sum.amount ?? 0)]));

  return json({
    kpis: {
      totalSalespersons,
      activeSalespersons,
      totalClients,
      todayOrdersCount: todayOrders._count,
      todaySales: Number(todayOrders._sum.grandTotal ?? 0),
      todayVerifiedCollections,
      todayPendingCollections,
      todayTotalCollections: todayVerifiedCollections + todayPendingCollections,
      totalOutstanding: Number(outstanding._sum.currentOutstanding ?? 0),
    },
    charts: {
      salesByDay: toSeries(salesByDay),
      collectionsByDay: toSeries(collectionsByDay),
      topProducts: topProductsData.map((tp) => ({ name: tp.productName, quantity: tp._sum.quantity || 0, total: Number(tp._sum.total || 0) })),
      salespersonPerformance: perfSps
        .map((s) => ({
          id: s.id,
          name: s.user.name,
          territory: s.territory,
          status: s.status,
          ordersCount: ordersBySp.get(s.id)?._count ?? 0,
          sales: Number(ordersBySp.get(s.id)?._sum.grandTotal ?? 0),
          collections: paysBySp.get(s.id) ?? 0,
        }))
        .sort((a, b) => b.sales - a.sales),
    },
  });
});
