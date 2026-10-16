import { prisma, AttendanceStatus, Role, SalespersonStatus } from '@/lib/db';
import { startAttendanceSchema, endAttendanceSchema } from '@/lib/validations/schemas';
import { calculatePathDistanceKm } from '@/lib/domain/geo';
import { HttpError, badRequest, forbidden } from '@/lib/http/errors';
import { findIdempotentResponse, storeIdempotentResponse, type StoredResponse } from '@/lib/services/idempotency';
import { isUniqueViolation } from '@/lib/services/numbering';
import { createNotification } from '@/lib/services/notifications';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import { notifyAttendanceChange } from '@/lib/realtime/emitter';
import { businessDateValue, DEFAULT_TIMEZONE } from '@/lib/time';
import type { AuthenticatedUser } from '@/lib/permissions';

function requireSalesperson(user: AuthenticatedUser, message: string): string {
  if (!user.salespersonId) throw forbidden(message);
  return user.salespersonId;
}

export async function startDay(
  user: AuthenticatedUser,
  rawInput: unknown,
  actor: AuditActor,
  opts: { at?: Date; endpoint?: string; tolerateActive?: boolean } = {}
): Promise<StoredResponse> {
  const input = startAttendanceSchema.parse(rawInput);
  const salespersonId = requireSalesperson(user, 'Only salesperson accounts can start a duty session');

  const replay = await findIdempotentResponse(input.idempotencyKey);
  if (replay) return replay;

  const existingActive = await prisma.attendance.findFirst({
    where: { salespersonId, status: AttendanceStatus.ON_DUTY },
    include: { sessions: { where: { status: 'ACTIVE' }, take: 1 } },
  });
  if (existingActive) {
    if (opts.tolerateActive) {
      return {
        status: 200,
        body: { data: { attendanceId: existingActive.id, sessionId: existingActive.sessions[0]?.id, loginAt: existingActive.loginAt, status: 'ON_DUTY' } },
      };
    }
    throw new HttpError(400, 'Salesperson is already ON DUTY with an active session', { attendanceId: existingActive.id });
  }

  const loginAt = opts.at ?? new Date();
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.create({
        data: {
          salespersonId,
          date: businessDateValue(loginAt),
          loginAt,
          loginLatitude: input.latitude,
          loginLongitude: input.longitude,
          status: AttendanceStatus.ON_DUTY,
        },
      });
      const session = await tx.locationSession.create({
        data: { salespersonId, attendanceId: attendance.id, startedAt: loginAt, status: 'ACTIVE' },
      });
      // First breadcrumb = real start coordinates reported by the device (if any).
      if (input.latitude !== undefined && input.longitude !== undefined) {
        await tx.locationPoint.create({
          data: { sessionId: session.id, salespersonId, latitude: input.latitude, longitude: input.longitude, deviceId: input.deviceId, timestamp: loginAt },
        });
      }
      await tx.salesperson.update({
        where: { id: salespersonId },
        data: { status: SalespersonStatus.ON_DUTY, ...(input.deviceId ? { deviceId: input.deviceId } : {}) },
      });
      const body = {
        message: 'Work session started. Tracking enabled.',
        data: { attendanceId: attendance.id, sessionId: session.id, loginAt: attendance.loginAt, status: 'ON_DUTY' },
      };
      await storeIdempotentResponse(tx, input.idempotencyKey, { endpoint: opts.endpoint ?? '/api/attendance/start', salespersonId, status: 201, body });
      return { attendance, body };
    });
  } catch (err) {
    // Unique (salespersonId, date, ON_DUTY) — a concurrent Start Day won the race.
    if (isUniqueViolation(err)) {
      const replayAfter = await findIdempotentResponse(input.idempotencyKey);
      if (replayAfter) return replayAfter;
      throw badRequest('Salesperson is already ON DUTY with an active session');
    }
    throw err;
  }

  await createNotification({
    role: Role.SUPER_ADMIN,
    title: 'Salesperson Started Day',
    message: `${user.name} started work session at ${loginAt.toLocaleTimeString('en-IN', { timeZone: DEFAULT_TIMEZONE })}.`,
    type: 'ATTENDANCE',
  });
  await logAuditEvent({
    actor,
    action: 'START_DAY',
    module: 'ATTENDANCE',
    recordId: result.attendance.id,
    newValue: { salespersonId, loginAt, lat: input.latitude, lng: input.longitude },
  });
  notifyAttendanceChange(salespersonId, { ...result.attendance, salespersonName: user.name, dutyStatus: 'ON_DUTY' });

  return { status: 201, body: result.body };
}

export async function endDay(
  user: AuthenticatedUser,
  rawInput: unknown,
  actor: AuditActor,
  opts: { at?: Date } = {}
): Promise<StoredResponse> {
  const input = endAttendanceSchema.parse(rawInput);
  const salespersonId = requireSalesperson(user, 'Only salesperson accounts can end duty session');

  const active = await prisma.attendance.findFirst({
    where: { salespersonId, status: AttendanceStatus.ON_DUTY },
    orderBy: { loginAt: 'desc' },
  });
  if (!active) throw badRequest('No active ON DUTY attendance session found');

  const logoutTime = opts.at && opts.at > active.loginAt ? opts.at : new Date();
  const loginTime = active.loginAt;
  const workingMinutes = Math.max(0, Math.floor((logoutTime.getTime() - loginTime.getTime()) / 60000));

  // Distance from high-confidence points only (same rule as route history).
  const points = await prisma.locationPoint.findMany({
    where: { salespersonId, isFiltered: false, timestamp: { gte: loginTime, lte: logoutTime } },
    orderBy: { timestamp: 'asc' },
    select: { latitude: true, longitude: true, accuracy: true, timestamp: true },
  });
  const distanceKm = calculatePathDistanceKm(points);

  const [visitsCount, orders, collections] = await Promise.all([
    prisma.clientVisit.count({ where: { salespersonId, startedAt: { gte: loginTime, lte: logoutTime } } }),
    prisma.order.findMany({ where: { salespersonId, createdAt: { gte: loginTime, lte: logoutTime } }, select: { grandTotal: true } }),
    prisma.payment.findMany({ where: { salespersonId, collectedAt: { gte: loginTime, lte: logoutTime } }, select: { amount: true, status: true } }),
  ]);
  const totalSales = orders.reduce((s, o) => s + Number(o.grandTotal), 0);
  const verifiedCollections = collections.filter((c) => c.status === 'VERIFIED').reduce((s, c) => s + Number(c.amount), 0);
  const pendingCollections = collections.filter((c) => c.status === 'PENDING').reduce((s, c) => s + Number(c.amount), 0);

  await prisma.$transaction(async (tx) => {
    await tx.locationSession.updateMany({
      where: { attendanceId: active.id, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: logoutTime },
    });

    // Unique (salespersonId, date, status): a second shift on the same day cannot become a second
    // COMPLETED row (legacy crashed here). Fold it into the day's existing COMPLETED record,
    // re-pointing its GPS sessions and expenses so no data is lost.
    const completedSameDay = await tx.attendance.findFirst({
      where: { salespersonId, date: active.date, status: AttendanceStatus.COMPLETED },
    });
    if (completedSameDay) {
      await tx.locationSession.updateMany({ where: { attendanceId: active.id }, data: { attendanceId: completedSameDay.id } });
      await tx.expense.updateMany({ where: { attendanceId: active.id }, data: { attendanceId: completedSameDay.id } });
      await tx.attendance.update({
        where: { id: completedSameDay.id },
        data: {
          logoutAt: logoutTime,
          logoutLatitude: input.latitude,
          logoutLongitude: input.longitude,
          workingMinutes: completedSameDay.workingMinutes + workingMinutes,
          distanceTravelled: Number((completedSameDay.distanceTravelled + distanceKm).toFixed(2)),
        },
      });
      await tx.attendance.delete({ where: { id: active.id } });
    } else {
      await tx.attendance.update({
        where: { id: active.id },
        data: {
          logoutAt: logoutTime,
          logoutLatitude: input.latitude,
          logoutLongitude: input.longitude,
          workingMinutes,
          distanceTravelled: distanceKm,
          status: AttendanceStatus.COMPLETED,
        },
      });
    }
    await tx.salesperson.update({ where: { id: salespersonId }, data: { status: SalespersonStatus.OFF_DUTY } });
  });

  notifyAttendanceChange(salespersonId, { id: active.id, status: 'COMPLETED', dutyStatus: 'OFF_DUTY', logoutAt: logoutTime, workingMinutes, distanceKm, salespersonName: user.name });

  const dailySummary = {
    loginTime,
    logoutTime,
    workingTimeFormatted: `${Math.floor(workingMinutes / 60)}h ${workingMinutes % 60}m`,
    workingMinutes,
    distanceKm,
    clientsVisited: visitsCount,
    ordersCount: orders.length,
    totalSales,
    verifiedCollections,
    pendingCollections,
    totalCollections: verifiedCollections + pendingCollections,
  };
  await logAuditEvent({ actor, action: 'END_DAY', module: 'ATTENDANCE', recordId: active.id, newValue: dailySummary });

  return { status: 200, body: { message: 'Work session completed. Tracking ended.', data: dailySummary } };
}
