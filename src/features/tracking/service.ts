import { prisma, SalespersonStatus } from '@/lib/db';
import { locationUpdateSchema } from '@/lib/validations/schemas';
import { isValidCoordinate, calculateHaversineDistanceMeters } from '@/lib/domain/geo';
import { DEFAULT_CONFIG } from '@/lib/domain/constants';
import { badRequest, forbidden } from '@/lib/http/errors';
import { notifySalespersonLocation } from '@/lib/realtime/emitter';
import type { AuthenticatedUser } from '@/lib/permissions';

const MAX_SPEED_KMH = 140;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Ingests device-reported GPS points (legacy POST /api/location/update|batch).
 * Points are never synthesised: only what the device reports is stored, and implausible
 * points are kept but flagged (`isFiltered`) so route history stays auditable.
 */
export async function ingestLocationPoints(
  user: AuthenticatedUser,
  rawInput: unknown,
  opts: { requireOnDuty?: boolean } = { requireOnDuty: true }
): Promise<{ pointsIngested: number; ingestedCount: number; sessionId: string }> {
  const input = locationUpdateSchema.parse(rawInput);
  const salespersonId = user.salespersonId;
  if (!salespersonId) throw forbidden('Only salesperson accounts can report location points');

  if (opts.requireOnDuty !== false) {
    const sp = await prisma.salesperson.findUnique({ where: { id: salespersonId }, select: { status: true } });
    if (!sp || sp.status !== SalespersonStatus.ON_DUTY) {
      throw forbidden('Location rejected: Salesperson is not ON DUTY. Start day before tracking.');
    }
  }

  // The session must belong to this salesperson (legacy trusted any sessionId in the body).
  let sessionId = input.sessionId;
  if (sessionId) {
    const owned = await prisma.locationSession.findFirst({ where: { id: sessionId, salespersonId }, select: { id: true } });
    if (!owned) sessionId = undefined;
  }
  if (!sessionId) {
    const session = await prisma.locationSession.findFirst({
      where: { salespersonId, ...(opts.requireOnDuty !== false ? { status: 'ACTIVE' as const } : {}) },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) throw badRequest('No active tracking session found');
    sessionId = session.id;
  }

  const now = new Date();
  const valid = [];
  for (let i = 0; i < input.points.length; i++) {
    const pt = input.points[i];
    if (!isValidCoordinate(pt.latitude, pt.longitude)) continue;
    const timestamp = new Date(pt.timestamp);
    if (isNaN(timestamp.getTime()) || timestamp.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) continue;

    let isFiltered = false;
    let filterReason: string | null = null;
    if (pt.accuracy && pt.accuracy > DEFAULT_CONFIG.MAX_GPS_ACCURACY_METERS) {
      isFiltered = true;
      filterReason = 'POOR_ACCURACY';
    }
    if (pt.speed && pt.speed > MAX_SPEED_KMH) {
      isFiltered = true;
      filterReason = 'IMPLAUSIBLE_SPEED_JUMP';
    } else if (i > 0) {
      const prev = input.points[i - 1];
      const dist = calculateHaversineDistanceMeters(prev.latitude, prev.longitude, pt.latitude, pt.longitude);
      const secs = Math.max(1, (timestamp.getTime() - new Date(prev.timestamp).getTime()) / 1000);
      if ((dist / secs) * 3.6 > MAX_SPEED_KMH) {
        isFiltered = true;
        filterReason = 'IMPLAUSIBLE_SPEED_JUMP';
      }
    }

    valid.push({
      sessionId,
      salespersonId,
      latitude: pt.latitude,
      longitude: pt.longitude,
      accuracy: pt.accuracy ?? null,
      speed: pt.speed ?? null,
      heading: pt.heading ?? null,
      batteryLevel: pt.batteryLevel ?? null,
      networkType: pt.networkType || null,
      deviceId: pt.deviceId || null,
      clientPointId: pt.clientPointId || undefined,
      isFiltered,
      filterReason,
      serverReceivedAt: now,
      timestamp,
    });
  }

  let inserted = 0;
  if (valid.length > 0) {
    inserted = (await prisma.locationPoint.createMany({ data: valid, skipDuplicates: true })).count;
    const latest = [...valid].reverse().find((p) => !p.isFiltered);
    if (latest) {
      notifySalespersonLocation(salespersonId, {
        latitude: latest.latitude,
        longitude: latest.longitude,
        accuracy: latest.accuracy,
        speed: latest.speed,
        heading: latest.heading,
        batteryLevel: latest.batteryLevel,
        timestamp: latest.timestamp.toISOString(),
      });
    }
  }
  return { pointsIngested: inserted, ingestedCount: inserted, sessionId };
}

