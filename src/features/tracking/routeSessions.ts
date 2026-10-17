import { calculatePathDistanceKm } from '@/lib/domain/geo';

/**
 * Per-session summary of a day's recorded route. Built only from stored points; a session is
 * labelled by how trustworthy its record is, never "completed" by assumption.
 *
 *  - in_progress: shift still open today
 *  - complete:    shift ended and at least two accepted fixes were recorded
 *  - incomplete:  shift ended with fewer than two usable fixes, or was never ended (an earlier day
 *                 left open) — the route shown is only what the phone actually reported
 */
export type RouteQuality = 'in_progress' | 'complete' | 'incomplete';

interface SessionRow {
  id: string;
  attendanceId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
}
interface PointRow {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  isFiltered: boolean;
  timestamp: Date;
}

export function summarizeSessions(sessions: SessionRow[], points: PointRow[], opts: { todayStart: Date; now?: Date }) {
  const now = opts.now ?? new Date();
  return sessions.map((s) => {
    const mine = points.filter((p) => p.sessionId === s.id).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const accepted = mine.filter((p) => !p.isFiltered);
    const open = s.endedAt === null && s.status === 'ACTIVE';
    const startedToday = s.startedAt.getTime() >= opts.todayStart.getTime();
    let quality: RouteQuality;
    if (open) quality = startedToday ? 'in_progress' : 'incomplete';
    else quality = accepted.length >= 2 ? 'complete' : 'incomplete';
    const end = s.endedAt ?? now;
    return {
      id: s.id,
      attendanceId: s.attendanceId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      status: s.status,
      quality,
      durationMinutes: Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 60000)),
      pointsCount: mine.length,
      acceptedPointsCount: accepted.length,
      flaggedPointsCount: mine.length - accepted.length,
      firstFixAt: accepted[0]?.timestamp ?? null,
      lastFixAt: accepted[accepted.length - 1]?.timestamp ?? null,
      distanceKm: calculatePathDistanceKm(accepted),
    };
  });
}
