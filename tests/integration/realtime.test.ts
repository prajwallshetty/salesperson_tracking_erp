import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { api, login, BASE, type Session } from './helpers';

const connect = (opts: Parameters<typeof io>[1]) =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(BASE(), { transports: ['websocket'], reconnection: false, timeout: 5000, ...opts });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => {
      s.close();
      reject(e);
    });
  });

describe('realtime (Socket.IO on the same server)', () => {
  let admin: Session, rahul: Session;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    [admin, rahul] = await Promise.all([login('admin@erp.com'), login('rahul@erp.com')]);
  });
  afterAll(() => sockets.forEach((s) => s.close()));

  it('rejects unauthenticated connections', async () => {
    await expect(connect({})).rejects.toThrow(/Missing token/);
    await expect(connect({ auth: { token: 'garbage' } })).rejects.toThrow(/Invalid or expired/);
  });

  it('accepts same-origin cookie auth and rejects unknown cross-origin browsers', async () => {
    const same = await connect({ extraHeaders: { Cookie: admin.cookie, Origin: BASE() } });
    sockets.push(same);
    expect(same.connected).toBe(true);
    await expect(connect({ extraHeaders: { Cookie: admin.cookie, Origin: 'https://evil.example' } })).rejects.toThrow();
  });

  it('pushes a salesperson GPS fix to the admin room', async () => {
    const s = await connect({ auth: { token: admin.token } });
    sockets.push(s);
    const received = new Promise<any>((resolve) => s.on('location:update', (env) => resolve(env)));
    // Rahul is seeded ON DUTY with an active session.
    const r = await api('/api/location/update', {
      token: rahul.token,
      body: { points: [{ latitude: 12.87, longitude: 74.842, accuracy: 9, timestamp: new Date().toISOString() }] },
    });
    expect(r.status).toBe(200);
    const env = await received;
    expect(env.type).toBe('location:update');
    expect(env.data.salespersonId).toBe(rahul.user.salespersonId);
    expect(env.data.point.latitude).toBe(12.87);
  });
});
