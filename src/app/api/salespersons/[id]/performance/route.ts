import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { canAccessSalesperson } from '@/lib/permissions';
import { businessDateString } from '@/lib/time';
import { performancePeriod } from '@/features/reports/period';

export const dynamic = 'force-dynamic';


export const GET = authedRoute<{ id: string }>({}, async ({ req, user, params }) => {
  const { id } = params;
  if (!canAccessSalesperson(user, id)) return json({ error: 'Access denied to this salesperson performance data' }, 403);

  const sp = searchParams(req);
  const range = sp.get('range') || 'this_month';
  const { start, end } = performancePeriod(range, sp.get('from'), sp.get('to'));
  const dateStart = new Date(`${businessDateString(start)}T00:00:00.000Z`);
  const dateEnd = new Date(`${businessDateString(end)}T00:00:00.000Z`);

  const [orders, payments, visitsCount, attendances] = await Promise.all([
    prisma.order.aggregate({ where: { salespersonId: id, createdAt: { gte: start, lte: end } }, _sum: { grandTotal: true }, _count: true }),
    prisma.payment.aggregate({ where: { salespersonId: id, collectedAt: { gte: start, lte: end }, status: 'VERIFIED' }, _sum: { amount: true } }),
    prisma.clientVisit.count({ where: { salespersonId: id, startedAt: { gte: start, lte: end } } }),
    prisma.attendance.aggregate({ where: { salespersonId: id, date: { gte: dateStart, lte: dateEnd } }, _sum: { distanceTravelled: true }, _count: true }),
  ]);

  return json({
    salespersonId: id,
    period: { range, from: start.toISOString(), to: end.toISOString() },
    totalSales: Number(orders._sum.grandTotal ?? 0),
    ordersCount: orders._count,
    totalCollections: Number(payments._sum.amount ?? 0),
    clientsVisited: visitsCount,
    distanceKm: Number((attendances._sum.distanceTravelled ?? 0).toFixed(1)),
    workingDays: attendances._count,
  });
});
