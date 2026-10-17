import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { api, login, BASE, uid, type Session } from './helpers';
import { businessDateString } from '@/lib/time';
import { calculateRouteDistanceMeters } from '@/lib/domain/geo';
import { purgeLocationPoints } from '@/lib/jobs/retention';

/**
 * GPS pipeline against the real server and database: ingest rules, live state, route history,
 * device-reported state, company isolation, stop rule and retention.
 *
 * Points are placed on YESTERDAY's business date (the session start is moved there through the
 * database) so the timeline is deterministic at any time of day.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public' } } });
const GX = 'GlobexPass123!';
const yday = businessDateString(new Date(Date.now() - 24 * 3600e3));
const T0 = new Date(`${yday}T06:00:00.000Z`).getTime(); // 11:30 IST yesterday
const tag = uid().replace(/[^a-z0-9]/gi, '').slice(-8);
const at = (min: number, base = T0) => new Date(base + min * 60000).toISOString();
const lat = (i: number) => 18.52 + i * 0.0009; // ≈100 m per step
const pt = (i: number, min: number, extra: Record<string, unknown> = {}) => ({
  clientPointId: `gps-${tag}-${i}`,
  latitude: lat(i),
  longitude: 73.85,
  accuracy: 8,
  speed: 5,
  timestamp: at(min),
  ...extra,
});

const connect = (token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(BASE(), { transports: ['websocket'], reconnection: false, timeout: 5000, auth: { token } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });

describe('GPS tracking and route history', () => {
  let A: Session, gxAdmin: Session, gxManager: Session, gita: Session, hari: Session;
  let gitaSp: string, hariSp: string, sessionId: string;
  const post = (s: Session, points: unknown[], extra: object = {}) => api('/api/location/batch', { token: s.token, body: { points, ...extra } });
  const history = (s: Session, sp: string, date = yday, q = '') => api(`/api/location/history?salespersonId=${sp}&date=${date}${q}`, { token: s.token });
  const live = async (s: Session, sp: string) => ((await api('/api/salespersons/live-status', { token: s.token })).json.data as any[]).find((x) => x.id === sp);
  // Only the points this test uploaded (Start Day also records the phone's real starting fix).
  const stored = () => db.locationPoint.findMany({ where: { salespersonId: gitaSp, clientPointId: { startsWith: `gps-${tag}-` } }, orderBy: { timestamp: 'asc' } });

  beforeAll(async () => {
    [A, gxAdmin, gxManager, gita, hari] = await Promise.all([
      login('admin@erp.com'),
      login('admin@erp.com', GX, 'globex'),
      login('manager@erp.com', GX, 'globex'),
      login('rahul@erp.com', GX, 'globex'),
      login('hari@globex.test', GX, 'globex'),
    ]);
    gitaSp = gita.user.salespersonId;
    hariSp = hari.user.salespersonId;
    const start = await api('/api/attendance/start', { token: gita.token, body: { latitude: 18.52, longitude: 73.85, deviceId: `dev-${tag}` } });
    expect(start.status).toBe(201);
  });
  afterAll(async () => {
    await api('/api/attendance/end', { token: gita.token, body: {} }).catch(() => undefined);
    await db.$disconnect();
  });

  it('a shift that has just started is "in progress" and its only point is the phone’s real starting fix', async () => {
    const today = await history(gita, gitaSp, businessDateString());
    expect(today.status).toBe(200);
    expect(today.json.sessions).toHaveLength(1);
    expect(today.json.sessions[0]).toMatchObject({ quality: 'in_progress', pointsCount: 1, acceptedPointsCount: 1, distanceKm: 0 });
    expect(today.json.lastKnown).toMatchObject({ latitude: 18.52, longitude: 73.85 });
    expect(today.json.liveState.state).toBe('live');
    sessionId = today.json.sessions[0].id;
    // Move the shift to yesterday (and drop the start fix) so the timeline below is deterministic.
    await db.locationPoint.deleteMany({ where: { sessionId, clientPointId: null } });
    await db.locationSession.update({ where: { id: sessionId }, data: { startedAt: new Date(T0 - 60 * 60000) } });
  });

  it('rejects malformed requests as a whole and caps the batch size', async () => {
    expect((await post(gita, [pt(0, 0, { latitude: 120 })])).status).toBe(400);
    expect((await post(gita, [pt(0, 0, { timestamp: 'yesterday' })])).status).toBe(400);
    expect((await post(gita, [pt(0, 0, { accuracy: -5 })])).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => pt(100 + i, 0));
    expect((await post(gita, many)).status).toBe(400);
    expect((await post(gita, [])).status).toBe(400);
    expect((await api('/api/location/batch', { body: { points: [pt(0, 0)] } })).status).toBe(401);
    expect((await stored()).length).toBe(0);
  });

  it('judges points in timestamp order, not arrival order, so a re-ordered upload is not "jumpy"', async () => {
    const r = await post(gita, [pt(2, 2), pt(1, 1), pt(0, 0)]); // arrives newest-first
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ingestedCount: 3, flagged: 0, duplicates: 0, rejected: 0 });
    expect((await stored()).every((p) => !p.isFiltered)).toBe(true);
  });

  it('duplicates (retries, repeats inside a request) are stored once', async () => {
    const again = await post(gita, [pt(0, 0), pt(1, 1), pt(2, 2)]);
    expect(again.json).toMatchObject({ ingestedCount: 0, duplicates: 3 });
    const dup = await post(gita, [pt(3, 3), pt(3, 3)]);
    expect(dup.json).toMatchObject({ ingestedCount: 1, duplicates: 1 });
    expect((await stored()).length).toBe(4);
  });

  it('flags poor accuracy and impossible jumps (also across batches) but keeps them for audit; one bad fix does not poison the next', async () => {
    const poor = await post(gita, [pt(4, 4, { accuracy: 300 })]);
    expect(poor.json.flagged).toBe(1);
    const jump = await post(gita, [pt(5, 5, { latitude: 19.2 })]); // ~75 km, 2 minutes after the last accepted fix
    expect(jump.json.flagged).toBe(1);
    const ok = await post(gita, [pt(6, 6, { latitude: lat(4) })]);
    expect(ok.json).toMatchObject({ ingestedCount: 1, flagged: 0 });
    const rows = await stored();
    expect(rows.find((p) => p.clientPointId === `gps-${tag}-4`)).toMatchObject({ isFiltered: true, filterReason: 'POOR_ACCURACY' });
    expect(rows.find((p) => p.clientPointId === `gps-${tag}-5`)).toMatchObject({ isFiltered: true, filterReason: 'IMPLAUSIBLE_SPEED_JUMP' });
    expect(rows.find((p) => p.clientPointId === `gps-${tag}-6`)?.isFiltered).toBe(false);
  });

  it('a late older point is stored but never moves the live position backwards', async () => {
    const before = await live(gxAdmin, gitaSp);
    expect(before.lastLatitude).toBeCloseTo(lat(4), 6);
    const late = await post(gita, [pt(7, 1.5, { latitude: lat(1) + 0.0004 })]);
    expect(late.json).toMatchObject({ ingestedCount: 1, flagged: 0 });
    const after = await live(gxAdmin, gitaSp);
    expect(after.lastLatitude).toBeCloseTo(lat(4), 6);
    expect(after.lastUpdate).toBe(before.lastUpdate);
  });

  it('points outside the shift’s time window are kept but flagged, never mixed into the route', async () => {
    const r = await post(gita, [pt(8, 0, { timestamp: at(-180) })]); // 3 h before the shift
    expect(r.json.flagged).toBe(1);
    expect((await stored()).find((p) => p.clientPointId === `gps-${tag}-8`)).toMatchObject({ filterReason: 'OUTSIDE_SESSION_WINDOW' });
    const future = await post(gita, [pt(9, 0, { timestamp: new Date(Date.now() + 3600e3).toISOString() })]);
    expect(future.json).toMatchObject({ ingestedCount: 0, rejected: 1 });
  });

  it('interruptions split the route and add no assumed distance; the shift is labelled by what was recorded', async () => {
    expect((await post(gita, [pt(10, 30, { latitude: lat(8) }), pt(11, 31, { latitude: lat(9) })])).json.ingestedCount).toBe(2);
    const h = await history(gita, gitaSp);
    expect(h.status).toBe(200);
    expect(h.json.segments).toHaveLength(2);
    const accepted = (h.json.rawPoints as any[]).filter((p) => !p.isFiltered);
    const expectedKm = Number((calculateRouteDistanceMeters(accepted.map((p) => ({ ...p, timestamp: p.timestamp }))) / 1000).toFixed(2));
    expect(h.json.estimatedDistanceKm).toBe(expectedKm);
    // The 6→30 minute gap (~400 m of walking) is not counted and no line crosses it.
    const straight = Number(((accepted.length - 1) * 0.1).toFixed(2));
    expect(h.json.estimatedDistanceKm).toBeLessThan(straight);
    expect(h.json.method).toBe('haversine-consecutive-accepted-fixes');
    expect(h.json.rejectedPointsCount).toBe(3); // poor accuracy, jump, outside window
    expect(h.json.lastKnown).toMatchObject({ latitude: lat(9), sessionId });
    expect(h.json.sessions[0]).toMatchObject({ id: sessionId, quality: 'incomplete', acceptedPointsCount: accepted.length, flaggedPointsCount: 3 });
    expect(h.json.sessions[0].firstFixAt).toBe(at(0));
    expect(h.json.sessions[0].lastFixAt).toBe(at(31));
    // Filtering to one session returns that session only.
    expect((await history(gita, gitaSp, yday, `&sessionId=${sessionId}`)).json.sessions).toHaveLength(1);
    expect((await history(gita, gitaSp, yday, '&sessionId=nope')).status).toBe(400);
  });

  it('the phone’s own report distinguishes "permission denied" from "weak signal"; a new fix clears it', async () => {
    expect((await live(gxAdmin, gitaSp)).liveState).toBe('stale'); // last real fix is from yesterday
    expect((await api('/api/location/status', { token: gita.token, body: { state: 'NOPE' } })).status).toBe(400);
    expect((await api('/api/location/status', { token: gxManager.token, body: { state: 'TRACKING' } })).status).toBe(403);
    expect((await api('/api/location/status', { body: { state: 'TRACKING' } })).status).toBe(401);

    const sb = await connect(gxAdmin.token);
    const sa = await connect(A.token);
    const evB = new Promise<any>((resolve) => sb.once('tracking:state', resolve));
    const gotA: string[] = [];
    sa.on('tracking:state', (e) => gotA.push(e.data.state));
    try {
      expect((await api('/api/location/status', { token: gita.token, body: { state: 'PERMISSION_DENIED', detail: 'Location permission refused' } })).status).toBe(200);
      const ev = await evB;
      expect(ev.data).toMatchObject({ salespersonId: gitaSp, state: 'PERMISSION_DENIED' });
      let g = await live(gxAdmin, gitaSp);
      expect(g).toMatchObject({ liveState: 'permission_denied', deviceTrackingState: 'PERMISSION_DENIED', deviceTrackingDetail: 'Location permission refused' });
      expect((await live(gxAdmin, hariSp)).liveState).toBe('off_duty'); // another salesperson is unaffected

      await api('/api/location/status', { token: gita.token, body: { state: 'GPS_DISABLED' } });
      expect((await live(gxManager, gitaSp)).liveState).toBe('gps_disabled'); // the manager's view agrees

      await api('/api/location/status', { token: gita.token, body: { state: 'BACKGROUND_DENIED' } });
      g = await live(gxAdmin, gitaSp);
      expect(g).toMatchObject({ liveState: 'stale', backgroundLimited: true });

      // A fresh, accepted fix makes the position live again.
      await api('/api/location/status', { token: gita.token, body: { state: 'PERMISSION_DENIED' } });
      expect((await live(gxAdmin, gitaSp)).liveState).toBe('permission_denied');
      await db.locationSession.update({ where: { id: sessionId }, data: { startedAt: new Date(Date.now() - 3600e3) } });
      const fresh = await post(gita, [{ clientPointId: `gps-${tag}-fresh`, latitude: lat(10), longitude: 73.85, accuracy: 6, speed: 4, timestamp: new Date().toISOString() }]);
      expect(fresh.json.ingestedCount).toBe(1);
      g = await live(gxAdmin, gitaSp);
      expect(g.liveState).toBe('live');
      expect(g.lastLatitude).toBeCloseTo(lat(10), 6);
      expect(g.accuracy).toBe(6);
      await new Promise((r) => setTimeout(r, 500));
      expect(gotA).toEqual([]); // the other company never hears about it
    } finally {
      sb.close();
      sa.close();
      await db.locationSession.update({ where: { id: sessionId }, data: { startedAt: new Date(T0 - 60 * 60000) } });
      await db.locationPoint.deleteMany({ where: { clientPointId: `gps-${tag}-fresh` } });
    }
  });

  it('live events carry only genuinely newer accepted fixes, to the right company', async () => {
    const sb = await connect(gxAdmin.token);
    const sa = await connect(A.token);
    const seenB: any[] = [];
    const seenA: any[] = [];
    sb.on('location:update', (e) => seenB.push(e));
    sa.on('location:update', (e) => seenA.push(e));
    try {
      await db.locationSession.update({ where: { id: sessionId }, data: { startedAt: new Date(Date.now() - 3600e3) } });
      const newer = { clientPointId: `gps-${tag}-live1`, latitude: lat(11), longitude: 73.85, accuracy: 7, timestamp: new Date().toISOString() };
      const older = { clientPointId: `gps-${tag}-live0`, latitude: lat(11) - 0.001, longitude: 73.85, accuracy: 7, timestamp: new Date(Date.now() - 20 * 60000).toISOString() };
      await post(gita, [newer]);
      await post(gita, [older]); // late
      await new Promise((r) => setTimeout(r, 700));
      expect(seenB).toHaveLength(1);
      expect(seenB[0].data.point.latitude).toBeCloseTo(lat(11), 6);
      expect(seenA).toHaveLength(0);
    } finally {
      sb.close();
      sa.close();
      await db.locationSession.update({ where: { id: sessionId }, data: { startedAt: new Date(T0 - 60 * 60000) } });
      await db.locationPoint.deleteMany({ where: { clientPointId: { in: [`gps-${tag}-live0`, `gps-${tag}-live1`] } } });
    }
  });

  it('a company or team can only see its own people’s locations', async () => {
    const names = (r: any) => (r.json.data as any[]).map((x) => x.salespersonName);
    expect(names(await api('/api/salespersons/live-status', { token: A.token }))).not.toContain('Gita Rao');
    expect(names(await api('/api/salespersons/live-status', { token: gxAdmin.token }))).toEqual(expect.arrayContaining(['Gita Rao', 'Hari Das']));
    expect(names(await api('/api/salespersons/live-status', { token: gxManager.token }))).toEqual(['Gita Rao']); // team only
    expect((await history(A, gitaSp)).status).toBe(404); // another company: the person does not exist for A
    expect((await history(gxManager, hariSp)).status).toBe(403); // not on this manager's team
    expect((await history(hari, gitaSp)).status).toBe(403);
    expect((await history(gxManager, gitaSp)).status).toBe(200);
    // Another company's points never appear in this company's route data, whichever date is asked.
    const mine = await history(A, A.user.salespersonId ?? (await login('rahul@erp.com')).user.salespersonId);
    expect(JSON.stringify(mine.json)).not.toContain(gitaSp);
  });

  it('ending the day closes the shift; later points are refused; the route is labelled complete', async () => {
    const end = await api('/api/attendance/end', { token: gita.token, body: { latitude: lat(10), longitude: 73.85 } });
    expect(end.status).toBe(200);
    const late = await post(gita, [pt(20, 40, { latitude: lat(10) })]);
    expect(late.status).toBe(403);
    expect(late.json.error).toMatch(/not ON DUTY/i);
    const h = await history(gita, gitaSp);
    expect(h.json.sessions[0]).toMatchObject({ id: sessionId, status: 'ENDED', quality: 'complete' });
    expect(h.json.sessions[0].endedAt).toBeTruthy();
    expect((await live(gxAdmin, gitaSp)).liveState).toBe('off_duty');
  });

  it('a second shift is a separate session: its route is never joined to the first', async () => {
    expect((await api('/api/attendance/start', { token: gita.token, body: { latitude: 18.52, longitude: 73.85, deviceId: `dev-${tag}` } })).status).toBe(201);
    const second = await db.locationSession.findFirstOrThrow({ where: { salespersonId: gitaSp, status: 'ACTIVE' } });
    expect(second.id).not.toBe(sessionId);
    const base2 = T0 + 4 * 3600e3;
    await db.locationSession.update({ where: { id: second.id }, data: { startedAt: new Date(base2 - 30 * 60000) } });
    const r = await post(gita, [pt(30, 0, { timestamp: at(0, base2), latitude: lat(30) }), pt(31, 1, { timestamp: at(1, base2), latitude: lat(31) })]);
    expect(r.json).toMatchObject({ ingestedCount: 2, flagged: 0, sessionId: second.id });
    const h = await history(gita, gitaSp);
    expect(h.json.sessions.map((s: any) => s.id).sort()).toEqual([sessionId, second.id].sort());
    for (const seg of h.json.segments as any[][]) expect(new Set(seg.map((p) => p.sessionId)).size).toBe(1);
    const one = (await history(gita, gitaSp, yday, `&sessionId=${second.id}`)).json;
    expect(one.pointsCount).toBe(2);
    expect(one.sessions).toHaveLength(1);
    await api('/api/attendance/end', { token: gita.token, body: {} });
  });

  it('retention removes only raw points older than the cutoff and keeps sessions, attendance and recent points', async () => {
    const sess = await db.locationSession.findFirstOrThrow({ where: { salespersonId: gitaSp }, orderBy: { startedAt: 'asc' } });
    const old = new Date(Date.now() - 400 * 86400e3);
    await db.locationPoint.createMany({
      data: [0, 1, 2].map((i) => ({
        tenantId: '00000000-0000-0000-0000-000000000002',
        sessionId: sess.id,
        salespersonId: gitaSp,
        latitude: lat(i),
        longitude: 73.85,
        timestamp: new Date(old.getTime() + i * 60000),
        clientPointId: `gps-${tag}-old${i}`,
      })),
    });
    const recentBefore = await db.locationPoint.count({ where: { salespersonId: gitaSp, timestamp: { gte: new Date(Date.now() - 30 * 86400e3) } } });
    const sessionsBefore = await db.locationSession.count({ where: { salespersonId: gitaSp } });
    const attendanceBefore = await db.attendance.count({ where: { salespersonId: gitaSp } });

    const res = await purgeLocationPoints(db, new Date(Date.now() - 365 * 86400e3));
    expect(res.total).toBeGreaterThanOrEqual(3);
    expect(res.perTenant['00000000-0000-0000-0000-000000000002']).toBeGreaterThanOrEqual(3);
    expect(await db.locationPoint.count({ where: { clientPointId: { startsWith: `gps-${tag}-old` } } })).toBe(0);
    expect(await db.locationPoint.count({ where: { salespersonId: gitaSp, timestamp: { gte: new Date(Date.now() - 30 * 86400e3) } } })).toBe(recentBefore);
    expect(await db.locationSession.count({ where: { salespersonId: gitaSp } })).toBe(sessionsBefore);
    expect(await db.attendance.count({ where: { salespersonId: gitaSp } })).toBe(attendanceBefore);
  });
});
