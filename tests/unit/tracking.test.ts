import { describe, it, expect } from 'vitest';
import { computeLiveState, LIVE_MAX_AGE_MINUTES } from '@/features/tracking/liveState';
import { summarizeSessions } from '@/features/tracking/routeSessions';
import { calculateRouteDistanceMeters, calculatePathDistanceKm, ROUTE_GAP_MINUTES } from '@/lib/domain/geo';

const now = new Date('2026-06-10T10:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60000);

describe('live state (what the console may claim)', () => {
  it('off duty is never reported as live, even with a recent fix', () => {
    expect(computeLiveState({ dutyStatus: 'OFF_DUTY', lastFixAt: ago(0), now }).state).toBe('off_duty');
  });

  it('live only while the last real fix is fresh; stale afterwards; unavailable with no fix at all', () => {
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(1), now }).state).toBe('live');
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(LIVE_MAX_AGE_MINUTES), now }).state).toBe('live');
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(LIVE_MAX_AGE_MINUTES + 1), now }).state).toBe('stale');
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(26 * 60), now }).label).toMatch(/1d ago/);
    const none = computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: null, now });
    expect(none.state).toBe('unavailable');
    expect(none.label).toMatch(/No location received/);
  });

  it('a device-reported denial wins only while it is newer than the last fix', () => {
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(30), deviceState: 'PERMISSION_DENIED', deviceStateAt: ago(2), now }).state).toBe('permission_denied');
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: null, deviceState: 'PERMISSION_DENIED', deviceStateAt: ago(2), now }).state).toBe('permission_denied');
    // A fix arrived after the report: the phone has recovered.
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(1), deviceState: 'PERMISSION_DENIED', deviceStateAt: ago(10), now }).state).toBe('live');
    expect(computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(20), deviceState: 'GPS_DISABLED', deviceStateAt: ago(3), now }).state).toBe('gps_disabled');
  });

  it('foreground-only tracking is flagged, and explains staleness, without changing freshness rules', () => {
    const fresh = computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(1), deviceState: 'BACKGROUND_DENIED', deviceStateAt: ago(60), now });
    expect(fresh).toMatchObject({ state: 'live', backgroundLimited: true });
    const stale = computeLiveState({ dutyStatus: 'ON_DUTY', lastFixAt: ago(40), deviceState: 'BACKGROUND_DENIED', deviceStateAt: ago(60), now });
    expect(stale.state).toBe('stale');
    expect(stale.label).toMatch(/only while the app is open/);
  });
});

describe('route distance method', () => {
  // ~111 m per 0.001° of latitude.
  const p = (i: number, min: number, extra: object = {}) => ({ latitude: 12 + i * 0.001, longitude: 77, timestamp: new Date(now.getTime() + min * 60000), ...extra });

  it('sums consecutive great-circle steps', () => {
    const m = calculateRouteDistanceMeters([p(0, 0), p(1, 1), p(2, 2)]);
    expect(m).toBeGreaterThan(215);
    expect(m).toBeLessThan(230);
    expect(calculatePathDistanceKm([p(0, 0)])).toBe(0);
  });

  it('does not bridge an interruption with a straight line', () => {
    const withGap = calculateRouteDistanceMeters([p(0, 0), p(1, 1), p(2, 1 + ROUTE_GAP_MINUTES + 1), p(3, 1 + ROUTE_GAP_MINUTES + 2)]);
    const twoSteps = calculateRouteDistanceMeters([p(0, 0), p(1, 1)]) + calculateRouteDistanceMeters([p(2, 0), p(3, 1)]);
    expect(withGap).toBe(twoSteps);
  });

  it('ignores stationary drift and poor-accuracy steps, and impossible speeds', () => {
    const drift = [0, 1, 2, 3].map((i) => ({ latitude: 12 + i * 0.00001, longitude: 77, timestamp: new Date(now.getTime() + i * 60000) })); // ~1 m steps
    expect(calculateRouteDistanceMeters(drift)).toBe(0);
    expect(calculateRouteDistanceMeters([p(0, 0), p(1, 1, { accuracy: 400 })])).toBe(0);
    expect(calculateRouteDistanceMeters([p(0, 0), { latitude: 13, longitude: 77, timestamp: new Date(now.getTime() + 30000) }])).toBe(0); // ~111 km in 30 s
  });
});

describe('route session summaries', () => {
  const todayStart = new Date('2026-06-10T00:00:00Z');
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 10, h, m));
  const pt = (sessionId: string, i: number, h: number, extra: object = {}) => ({ sessionId, latitude: 12 + i * 0.001, longitude: 77, accuracy: 10, isFiltered: false, timestamp: t(h, i), ...extra });

  it('labels in-progress, complete and incomplete sessions without guessing', () => {
    const sessions = [
      { id: 'open-today', attendanceId: 'a', startedAt: t(4), endedAt: null, status: 'ACTIVE' },
      { id: 'done', attendanceId: 'b', startedAt: t(1), endedAt: t(3), status: 'ENDED' },
      { id: 'one-fix', attendanceId: 'c', startedAt: t(1), endedAt: t(2), status: 'ENDED' },
      { id: 'never-closed', attendanceId: 'd', startedAt: new Date('2026-06-09T04:00:00Z'), endedAt: null, status: 'ACTIVE' },
    ];
    const points = [
      pt('open-today', 0, 4), pt('open-today', 1, 4),
      pt('done', 0, 1), pt('done', 1, 1), pt('done', 2, 1, { isFiltered: true }),
      pt('one-fix', 0, 1),
    ];
    const out = summarizeSessions(sessions, points, { todayStart, now: t(5) });
    const by = Object.fromEntries(out.map((s) => [s.id, s]));
    expect(by['open-today']).toMatchObject({ quality: 'in_progress', durationMinutes: 60, acceptedPointsCount: 2 });
    expect(by['done']).toMatchObject({ quality: 'complete', durationMinutes: 120, pointsCount: 3, acceptedPointsCount: 2, flaggedPointsCount: 1 });
    expect(by['done'].distanceKm).toBeGreaterThan(0);
    expect(by['one-fix'].quality).toBe('incomplete');
    expect(by['never-closed'].quality).toBe('incomplete');
    expect(by['never-closed'].pointsCount).toBe(0);
    expect(by['done'].lastFixAt).toEqual(t(1, 1));
  });
});
