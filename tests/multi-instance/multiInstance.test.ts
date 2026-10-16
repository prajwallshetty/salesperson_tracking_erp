import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { io, type Socket } from 'socket.io-client';

/**
 * Multi-instance mode (REDIS_URL): two real production servers on different ports, one database,
 * one Redis. Verifies that realtime events, session revocation and rate limits cross instances,
 * and that a Redis outage degrades instead of failing requests.
 */
const DB_URL = process.env.MULTI_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_multi_test?schema=public';
const REDIS_PORT = 6391;
const REDIS_URL = process.env.TEST_REDIS_URL || `redis://127.0.0.1:${REDIS_PORT}`;
const A = 'http://localhost:3111';
const B = 'http://localhost:3112';
const children: ChildProcess[] = [];
let redis: ChildProcess | undefined;

async function waitHealthy(base: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${base} did not become healthy`);
}

async function call(base: string, path: string, opts: { token?: string; body?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
  const res = await fetch(`${base}${path}`, { method: opts.body !== undefined ? 'POST' : 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

const login = async (base: string, identifier: string) => {
  const r = await call(base, '/api/auth/login', { body: { identifier, password: 'Password123!' }, ip: `10.0.0.${Math.floor(Math.random() * 200) + 1}` });
  if (r.status !== 200) throw new Error(`login failed ${r.status}`);
  return r.json as { token: string; user: any };
};

const connect = (base: string, token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(base, { transports: ['websocket'], reconnection: false, auth: { token } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });

beforeAll(async () => {
  if (!existsSync('.next/BUILD_ID')) throw new Error('Run `npm run build` before the multi-instance test');
  if (!/_test\b/.test(new URL(DB_URL).pathname)) throw new Error('Refusing to use a non-test database');

  if (!process.env.TEST_REDIS_URL) {
    redis = spawn('redis-server', ['--port', String(REDIS_PORT), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 500));
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: DB_URL,
    REDIS_URL,
    JWT_SECRET: 'multi-instance-test-secret-0123456789-abcdefghij',
    COOKIE_SECURE: 'false',
    UPLOAD_DIR: './.test-uploads',
    AUTH_RATE_LIMIT_MAX: '4',
    DISABLE_RATE_LIMIT: '',
  } as NodeJS.ProcessEnv;
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { env, stdio: 'ignore' });
  execSync('npx tsx prisma/seed.ts', { env: { ...env, NODE_ENV: 'development' }, stdio: 'ignore' });

  for (const port of ['3111', '3112']) {
    children.push(spawn('npx', ['tsx', 'server.ts'], { env: { ...env, PORT: port }, stdio: 'ignore', detached: true }));
  }
  await Promise.all([waitHealthy(A), waitHealthy(B)]);
});

afterAll(() => {
  for (const c of children) {
    try {
      process.kill(-c.pid!, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
  redis?.kill('SIGTERM');
});

describe('two instances sharing Redis', () => {
  it('both report Redis as up', async () => {
    for (const base of [A, B]) {
      const h = await call(base, '/api/health');
      expect(h.json.redis).toBe('up');
      expect(h.json.features.socketIO).toBe(true);
    }
  });

  it('a GPS fix received by instance A reaches a dashboard connected to instance B', async () => {
    const [admin, rahul] = await Promise.all([login(B, 'admin@erp.com'), login(A, 'rahul@erp.com')]);
    const socket = await connect(B, admin.token);
    try {
      const received = new Promise<any>((resolve) => socket.on('location:update', resolve));
      const r = await call(A, '/api/location/update', {
        token: rahul.token,
        body: { points: [{ latitude: 12.871, longitude: 74.843, accuracy: 8, timestamp: new Date().toISOString() }] },
      });
      expect(r.status).toBe(200);
      const env = await received;
      expect(env.data.salespersonId).toBe(rahul.user.salespersonId);
      expect(env.data.point.latitude).toBe(12.871);
    } finally {
      socket.close();
    }
  });

  it('ending sessions on instance A drops the user’s socket on instance B', async () => {
    const [admin, vishal] = await Promise.all([login(A, 'admin@erp.com'), login(B, 'vishal@erp.com')]);
    const socket = await connect(B, vishal.token);
    const dropped = new Promise<string>((resolve) => socket.on('disconnect', resolve));
    expect((await call(A, '/api/auth/sessions/revoke', { token: admin.token, body: { userId: vishal.user.id } })).status).toBe(200);
    expect(await dropped).toBe('io server disconnect');
    expect((await call(B, '/api/auth/me', { token: vishal.token })).status).toBe(401);
  });

  it('rate limits are counted across instances', async () => {
    const ip = '203.0.113.77';
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const base = i % 2 === 0 ? A : B;
      statuses.push((await call(base, '/api/auth/login', { body: { identifier: 'admin@erp.com', password: 'wrong-password' }, ip })).status);
    }
    // AUTH_RATE_LIMIT_MAX=4: per-process counters would allow 5 (3 on A, 2 on B).
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
  });

  it('a Redis outage degrades to per-instance limits instead of failing requests', async () => {
    if (!redis) return; // external Redis: do not stop it
    redis.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
    const h = await call(A, '/api/health');
    expect(h.status).toBe(200);
    expect(h.json.redis).toBe('down');
    const r = await call(A, '/api/auth/login', { body: { identifier: 'manager@erp.com', password: 'Password123!' }, ip: '198.51.100.9' });
    expect(r.status).toBe(200);
  });
});
