import { prisma, Role } from '@/lib/db';
import { calculatePathDistanceKm } from '@/lib/domain/geo';
import { authedRoute, json } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { canAccessSalesperson } from '@/lib/permissions';
import { summarizeSessions } from '@/features/tracking/routeSessions';
import { computeLiveState } from '@/features/tracking/liveState';
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

  // Optional: a single shift (session) of that day.
  const sessionFilter = sp.get('sessionId');
  if (sessionFilter && !/^[0-9a-f-]{36}$/i.test(sessionFilter)) return json({ error: 'Invalid sessionId parameter' }, 400);

  const [salesperson, daySessions] = await Promise.all([
    prisma.salesperson.findFirst({ where: { id: target }, select: { status: true, trackingState: true, trackingStateAt: true } }),
    prisma.locationSession.findMany({
      where: { salespersonId: target, startedAt: { lte: end }, OR: [{ endedAt: null }, { endedAt: { gte: start } }], ...(sessionFilter ? { id: sessionFilter } : {}) },
      orderBy: { startedAt: 'asc' },
      select: { id: true, attendanceId: true, startedAt: true, endedAt: true, status: true },
    }),
  ]);
  if (!salesperson) return json({ error: 'Salesperson not found' }, 404);

  const points = await prisma.locationPoint.findMany({
    where: { salespersonId: target, timestamp: { gte: start, lte: end }, ...(sessionFilter ? { sessionId: sessionFilter } : {}) },
    orderBy: { timestamp: 'asc' },
    select: { id: true, sessionId: true, latitude: true, longitude: true, accuracy: true, speed: true, batteryLevel: true, isFiltered: true, filterReason: true, timestamp: true },
  });

  // Polyline segments are built from ACCEPTED fixes only (flagged points are never drawn or counted;
  // they remain in `rawPoints` for audit). A segment ends at a tracking gap (lost signal, app closed,
  // device restrictions) and at a shift boundary, so two sessions are never joined by a line.
  const accepted = points.filter((p) => !p.isFiltered);
  const segments: (typeof points)[] = [];
  let current: typeof points = [];
  for (let i = 0; i < accepted.length; i++) {
    const gap = i > 0 && (accepted[i].timestamp.getTime() - accepted[i - 1].timestamp.getTime()) / 60000 > GAP_MINUTES;
    const newSession = i > 0 && accepted[i].sessionId !== accepted[i - 1].sessionId;
    if (gap || newSession) {
      if (current.length) segments.push(current);
      current = [];
    }
    current.push(accepted[i]);
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
  const sessions = summarizeSessions(daySessions, points, { todayStart: startOfBusinessDate(businessDateString()) });
  const lastPoint = displayPoints[displayPoints.length - 1];
  const live = computeLiveState({ dutyStatus: salesperson.status, lastFixAt: lastPoint?.timestamp, deviceState: salesperson.trackingState, deviceStateAt: salesperson.trackingStateAt });
  return json({
    salespersonId: target,
    date: ymd,
    pointsCount: points.length,
    filteredPointsCount: displayPoints.length,
    rejectedPointsCount: points.length - displayPoints.length,
    // Sum of great-circle distances between consecutive accepted fixes; steps across a gap longer than
    // 15 minutes are not counted and no straight line is assumed (see calculateRouteDistanceMeters).
    estimatedDistanceKm: calculatePathDistanceKm(displayPoints),
    method: 'haversine-consecutive-accepted-fixes',
    disclaimer:
      'Distance and travel times are algorithmic estimates based on sampled GPS fixes. Gaps indicate lost signal, app suspension, or device restrictions; no distance is assumed across a gap.',
    sessions,
    lastKnown: lastPoint
      ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude, accuracy: lastPoint.accuracy, timestamp: lastPoint.timestamp, sessionId: lastPoint.sessionId }
      : null,
    liveState: ymd === businessDateString() ? { state: live.state, label: live.label, backgroundLimited: live.backgroundLimited } : null,
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
