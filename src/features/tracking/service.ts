import { prisma, SalespersonStatus, type TrackingDeviceState } from '@/lib/db';
import { locationUpdateSchema, trackingStatusSchema } from '@/lib/validations/schemas';
import { isValidCoordinate, calculateHaversineDistanceMeters } from '@/lib/domain/geo';
import { DEFAULT_CONFIG } from '@/lib/domain/constants';
import { badRequest, forbidden } from '@/lib/http/errors';
import { notifySalespersonLocation, notifyTrackingState } from '@/lib/realtime/emitter';
import type { AuthenticatedUser } from '@/lib/permissions';

const MAX_SPEED_KMH = 140;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Points may arrive late (offline queue) but must belong to the shift they are filed under. */
const SESSION_WINDOW_SLACK_MS = 5 * 60 * 1000;

export interface IngestResult {
  pointsIngested: number;
  ingestedCount: number;
  sessionId: string;
  /** Stored but excluded from the live position and route (poor accuracy, implausible jump, outside the shift). */
  flagged: number;
  /** Already stored (same clientPointId) or repeated inside the request. */
  duplicates: number;
  /** Not stored: invalid coordinates or timestamp. */
  rejected: number;
}

/**
 * Ingests device-reported GPS points (POST /api/location/update|batch).
 *
 * Identity: the salesperson and company come from the authenticated user, never from the body.
 * Points are never synthesised; only what the device reports is stored. Implausible points are kept
 * but flagged (`isFiltered`) so route history stays auditable.
 *
 * Ordering: a batch is processed in TIMESTAMP order, not arrival order, and each point is judged
 * against the last ACCEPTED stored point before it (also across batches), so late or re-ordered
 * uploads neither create false "jumps" nor let one bad fix poison the next. A late point never
 * moves the live position backwards.
 */
export async function ingestLocationPoints(
  user: AuthenticatedUser,
  rawInput: unknown,
  opts: { requireOnDuty?: boolean } = { requireOnDuty: true }
): Promise<IngestResult> {
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
  let session = input.sessionId
    ? await prisma.locationSession.findFirst({ where: { id: input.sessionId, salespersonId }, select: { id: true, startedAt: true, endedAt: true } })
    : null;
  if (!session) {
    session = await prisma.locationSession.findFirst({
      where: { salespersonId, ...(opts.requireOnDuty !== false ? { status: 'ACTIVE' as const } : {}) },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true, endedAt: true },
    });
  }
  if (!session) throw badRequest('No active tracking session found');
  const sessionId = session.id;

  const now = Date.now();
  let rejected = 0;
  let duplicates = 0;
  const seen = new Set<string>();
  const candidates: { pt: (typeof input.points)[number]; ts: number }[] = [];
  for (const pt of input.points) {
    const ts = new Date(pt.timestamp).getTime();
    if (!isValidCoordinate(pt.latitude, pt.longitude) || isNaN(ts) || ts > now + MAX_FUTURE_SKEW_MS) {
      rejected++;
      continue;
    }
    const key = pt.clientPointId ?? `${ts}:${pt.latitude}:${pt.longitude}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    candidates.push({ pt, ts });
  }
  candidates.sort((a, b) => a.ts - b.ts);
  if (!candidates.length) return { pointsIngested: 0, ingestedCount: 0, sessionId, flagged: 0, duplicates, rejected };

  // Reference for the first point: the last accepted stored point of this session before it.
  const [priorInSession, latestAcceptedOverall] = await Promise.all([
    prisma.locationPoint.findFirst({
      where: { sessionId, isFiltered: false, timestamp: { lt: new Date(candidates[0].ts) } },
      orderBy: { timestamp: 'desc' },
      select: { latitude: true, longitude: true, timestamp: true },
    }),
    prisma.locationPoint.findFirst({ where: { salespersonId, isFiltered: false }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
  ]);
  let prev = priorInSession ? { lat: priorInSession.latitude, lon: priorInSession.longitude, ts: priorInSession.timestamp.getTime() } : null;

  const windowStart = session.startedAt.getTime() - SESSION_WINDOW_SLACK_MS;
  const windowEnd = session.endedAt ? session.endedAt.getTime() + SESSION_WINDOW_SLACK_MS : Infinity;

  const received = new Date(now);
  const rows = candidates.map(({ pt, ts }) => {
    let filterReason: string | null = null;
    if (ts < windowStart || ts > windowEnd) filterReason = 'OUTSIDE_SESSION_WINDOW';
    else if (pt.accuracy && pt.accuracy > DEFAULT_CONFIG.MAX_GPS_ACCURACY_METERS) filterReason = 'POOR_ACCURACY';
    else if (pt.speed && pt.speed > MAX_SPEED_KMH) filterReason = 'IMPLAUSIBLE_SPEED_JUMP';
    else if (prev) {
      const dist = calculateHaversineDistanceMeters(prev.lat, prev.lon, pt.latitude, pt.longitude);
      const secs = Math.max(1, (ts - prev.ts) / 1000);
      if ((dist / secs) * 3.6 > MAX_SPEED_KMH) filterReason = 'IMPLAUSIBLE_SPEED_JUMP';
    }
    if (!filterReason) prev = { lat: pt.latitude, lon: pt.longitude, ts };
    return {
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
      isFiltered: filterReason !== null,
      filterReason,
      serverReceivedAt: received,
      timestamp: new Date(ts),
    };
  });

  const inserted = (await prisma.locationPoint.createMany({ data: rows, skipDuplicates: true })).count;
  duplicates += rows.length - inserted;

  // Live position: only the newest ACCEPTED point, and only if it is newer than what the map already has.
  const newest = [...rows].reverse().find((p) => !p.isFiltered);
  if (inserted > 0 && newest && (!latestAcceptedOverall || newest.timestamp.getTime() > latestAcceptedOverall.timestamp.getTime())) {
    notifySalespersonLocation(salespersonId, {
      latitude: newest.latitude,
      longitude: newest.longitude,
      accuracy: newest.accuracy,
      speed: newest.speed,
      heading: newest.heading,
      batteryLevel: newest.batteryLevel,
      timestamp: newest.timestamp.toISOString(),
    });
  }
  return { pointsIngested: inserted, ingestedCount: inserted, sessionId, flagged: rows.filter((r) => r.isFiltered).length, duplicates, rejected };
}

/**
 * Records what the salesperson's phone says about its own location capability (permission refused,
 * location services off, background tracking refused…). This is the only way the console can tell
 * "no fixes because the permission was denied" from "no fixes because the signal is weak".
 */
export async function reportTrackingState(user: AuthenticatedUser, rawInput: unknown) {
  if (!user.salespersonId) throw forbidden('Only salesperson accounts can report tracking state');
  const { state, detail } = trackingStatusSchema.parse(rawInput);
  const at = new Date();
  const updated = await prisma.salesperson.update({
    where: { id: user.salespersonId },
    data: { trackingState: state as TrackingDeviceState, trackingStateAt: at, trackingDetail: detail ?? null },
    select: { id: true, status: true },
  });
  notifyTrackingState(updated.id, { state, detail: detail ?? null, at: at.toISOString(), dutyStatus: updated.status });
  return { state, at };
}

export { formatFreshness } from './freshness';
