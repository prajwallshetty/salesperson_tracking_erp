import { prisma, Role } from '@/lib/db';
import { calculatePathDistanceKm } from '@/lib/domain/geo';
import { authedRoute, json } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { canAccessSalesperson } from '@/lib/permissions';
import { businessDateString, endOfBusinessDate, startOfBusinessDate, toBusinessDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

const GAP_MINUTES = 15;

export const GET = authedRoute({ managerPermission: 'canViewGps' }, async ({ req, user }) => {
  const sp = searchParams(req);
  let target = sp.get('salespersonId');
  if (!target) {
    if (user.role === Role.SALESPERSON && user.salespersonId) target = user.salespersonId;
    else return json({ error: 'salespersonId parameter is required' }, 400);
  }
  if (!canAccessSalesperson(user, target)) return json({ error: 'Access denied to this salesperson location history' }, 403);

  let ymd: string;
  try {
    ymd = sp.get('date') ? toBusinessDateString(sp.get('date')!) : businessDateString();
  } catch {
    return json({ error: 'Invalid date parameter' }, 400);
  }
  const start = startOfBusinessDate(ymd);
  const end = endOfBusinessDate(ymd);
  const dateValue = new Date(`${ymd}T00:00:00.000Z`);

  const points = await prisma.locationPoint.findMany({
    where: { salespersonId: target, timestamp: { gte: start, lte: end } },
    orderBy: { timestamp: 'asc' },
    select: { id: true, latitude: true, longitude: true, accuracy: true, speed: true, batteryLevel: true, isFiltered: true, filterReason: true, timestamp: true },
  });

  // Polyline segments split at tracking gaps (lost signal, app closed, device restrictions).
  const segments: (typeof points)[] = [];
  let current: typeof points = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && (points[i].timestamp.getTime() - points[i - 1].timestamp.getTime()) / 60000 > GAP_MINUTES) {
      if (current.length) segments.push(current);
      current = [];
    }
    current.push(points[i]);
  }
  if (current.length) segments.push(current);

  const [visits, orders, payments, expenses, attendance] = await Promise.all([
    prisma.clientVisit.findMany({
      where: { salespersonId: target, startedAt: { gte: start, lte: end } },
      include: { client: { select: { id: true, name: true, address: true, latitude: true, longitude: true } } },
      orderBy: { startedAt: 'asc' },
    }),
    prisma.order.findMany({ where: { salespersonId: target, createdAt: { gte: start, lte: end } }, include: { client: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.payment.findMany({ where: { salespersonId: target, collectedAt: { gte: start, lte: end } }, include: { client: { select: { name: true } } }, orderBy: { collectedAt: 'asc' } }),
    prisma.expense.findMany({ where: { salespersonId: target, expenseDate: { gte: start, lte: end } }, orderBy: { expenseDate: 'asc' } }),
    prisma.attendance.findFirst({ where: { salespersonId: target, date: dateValue }, orderBy: { loginAt: 'asc' } }),
  ]);

  const displayPoints = points.filter((p) => !p.isFiltered);
  return json({
    salespersonId: target,
    date: ymd,
    pointsCount: points.length,
    filteredPointsCount: displayPoints.length,
    rejectedPointsCount: points.length - displayPoints.length,
    estimatedDistanceKm: calculatePathDistanceKm(displayPoints),
    disclaimer:
      'Distance and travel times are algorithmic estimates based on sampled GPS fixes. Gaps indicate lost signal, app suspension, or device restrictions.',
    attendance: attendance
      ? { loginAt: attendance.loginAt, logoutAt: attendance.logoutAt, status: attendance.status, workingMinutes: attendance.workingMinutes, distanceTravelled: attendance.distanceTravelled }
      : null,
    rawPoints: points,
    segments,
    events: {
      visits: visits.map((v) => ({
        id: v.id,
        clientName: v.client.name,
        address: v.client.address,
        latitude: v.latitude ?? v.client.latitude,
        longitude: v.longitude ?? v.client.longitude,
        startedAt: v.startedAt,
        endedAt: v.endedAt,
        outcome: v.outcome,
        notes: v.notes,
        distanceFromClient: v.distanceFromClient,
        isException: v.isException,
      })),
      orders: orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, clientName: o.client.name, grandTotal: Number(o.grandTotal), createdAt: o.createdAt })),
      payments: payments.map((p) => ({ id: p.id, receiptNumber: p.receiptNumber, clientName: p.client.name, amount: Number(p.amount), paymentMethod: p.paymentMethod, collectedAt: p.collectedAt })),
      expenses: expenses.map((e) => ({
        id: e.id,
        expenseNumber: e.expenseNumber,
        category: e.category,
        amount: parseFloat(e.amount.toString()),
        description: e.description,
        latitude: e.latitude,
        longitude: e.longitude,
        expenseDate: e.expenseDate,
      })),
    },
  });
});
