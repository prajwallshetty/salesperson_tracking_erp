import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { canAccessSalesperson } from '@/lib/permissions';
import { startOfBusinessDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ req, user }) => {
  const requested = searchParams(req).get('salespersonId');
  // Legacy defect fixed: any user could pass ?salespersonId= to read a colleague's dashboard.
  const target = requested && user.role !== 'SALESPERSON' ? requested : user.salespersonId;
  if (!target) return json({ error: 'Salesperson profile not found for user' }, 403);
  if (!canAccessSalesperson(user, target)) return json({ error: 'Access denied to this salesperson dashboard' }, 403);

  const today = startOfBusinessDay();
  const [todayOrders, todayCollections, todayVisits, assignedClientsCount, activeAttendance, outstanding] = await Promise.all([
    prisma.order.aggregate({ where: { salespersonId: target, createdAt: { gte: today } }, _sum: { grandTotal: true }, _count: true }),
    prisma.payment.groupBy({ by: ['status'], where: { salespersonId: target, collectedAt: { gte: today } }, _sum: { amount: true } }),
    prisma.clientVisit.findMany({ where: { salespersonId: target, startedAt: { gte: today } }, select: { clientId: true }, distinct: ['clientId'] }),
    prisma.clientAssignment.count({ where: { salespersonId: target, active: true } }),
    prisma.attendance.findFirst({ where: { salespersonId: target, status: 'ON_DUTY' }, orderBy: { loginAt: 'desc' } }),
    prisma.client.aggregate({
      where: { assignments: { some: { salespersonId: target, active: true } } },
      _sum: { currentOutstanding: true },
    }),
  ]);

  const sumFor = (status: string) => Number(todayCollections.find((c) => c.status === status)?._sum.amount ?? 0);
  const verifiedCollections = sumFor('VERIFIED');
  const pendingCollections = sumFor('PENDING');

  return json({
    todaySales: Number(todayOrders._sum.grandTotal ?? 0),
    ordersCount: todayOrders._count,
    verifiedCollections,
    pendingCollections,
    totalCollectionsToday: verifiedCollections + pendingCollections,
    clientsVisited: todayVisits.length,
    totalAssignedClients: assignedClientsCount,
    totalAssignedOutstanding: Number(outstanding._sum.currentOutstanding ?? 0),
    dutyStatus: activeAttendance ? 'ON_DUTY' : 'OFF_DUTY',
    loginTime: activeAttendance?.loginAt || null,
    attendanceId: activeAttendance?.id || null,
  });
});
