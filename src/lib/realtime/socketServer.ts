import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { resolveSessionToken } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { setIO } from './emitter';
import { createAdapter } from '@socket.io/redis-adapter';
import { newRedisClient, redisEnabled } from '@/lib/redis';

/** Same rooms, events and authorization as the legacy API's socket server. */

const socketRateLimits = new Map<string, { count: number; resetAt: number }>();

function tokenFromHandshake(socket: Socket): string | null {
  const auth =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization ||
    (config.allowQueryToken ? socket.handshake.query?.token : undefined);
  if (auth) {
    const s = String(auth);
    return s.startsWith('Bearer ') ? s.slice(7) : s;
  }
  // Browser clients on the same origin authenticate with the httpOnly session cookie.
  const cookie = socket.handshake.headers?.cookie;
  if (cookie) {
    const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (match) return decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  }
  return null;
}

export function initSocketServer(httpServer: HttpServer, allowedOrigins: string[]): SocketIOServer {
  const allowed = new Set(allowedOrigins);
  const io = new SocketIOServer(httpServer, {
    // Cross-origin browser clients (CORS_ORIGINS) only; same-origin is checked in allowRequest.
    cors: allowed.size ? { origin: [...allowed], credentials: true } : undefined,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true); // native / server-to-server clients
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        return cb('Invalid origin', false);
      }
      const sameOrigin = host === req.headers.host || host === req.headers['x-forwarded-host'];
      const devLocal = process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
      if (sameOrigin || allowed.has(origin) || devLocal) return cb(null, true);
      return cb(`Origin ${origin} not allowed`, false);
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token = tokenFromHandshake(socket);
      if (!token) return next(new Error('Authentication error: Missing token'));
      const { user, payload } = await resolveSessionToken(token);
      if (!payload) return next(new Error('Authentication error: Invalid or expired token'));
      if (!user) return next(new Error('Authentication error: User account is inactive or revoked'));
      socket.data.user = user;
      return next();
    } catch (err) {
      console.error('Socket authentication exception:', err);
      return next(new Error('Internal server error during socket authentication'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) return void socket.disconnect(true);

    socket.join(`user:${user.id}`);
    if (user.role === 'SUPER_ADMIN') {
      socket.join('admins');
      socket.join('managers');
    } else if (user.role === 'MANAGER') {
      socket.join('managers');
      socket.join(`manager:${user.id}`);
      for (const spId of user.managedSalespersonIds || []) socket.join(`team:${spId}`);
    } else if (user.role === 'SALESPERSON' && user.salespersonId) {
      socket.join('salespersons');
      socket.join(`salesperson:${user.salespersonId}`);
      socket.join(`team:${user.salespersonId}`);
    }

    socket.on('ping:telemetry', (payload) => {
      const now = Date.now();
      const current = socketRateLimits.get(socket.id) || { count: 0, resetAt: now + 60000 };
      if (now > current.resetAt) {
        current.count = 0;
        current.resetAt = now + 60000;
      }
      current.count += 1;
      socketRateLimits.set(socket.id, current);
      if (current.count > 120) {
        socket.emit('error', { message: 'Rate limit exceeded. Slow down.' });
        return;
      }
      socket.emit('pong:telemetry', { serverTime: new Date().toISOString(), received: payload });
    });

    socket.on('subscribe:room', ({ room }: { room?: unknown } = {}) => {
      if (typeof room !== 'string') return;
      const sp = user.salespersonId;
      const isAllowed =
        user.role === 'SUPER_ADMIN' ||
        room === `user:${user.id}` ||
        (user.role === 'SALESPERSON' && (room === `salesperson:${sp}` || room === `team:${sp}`)) ||
        (user.role === 'MANAGER' &&
          (room === 'managers' ||
            room === `manager:${user.id}` ||
            (room.startsWith('team:') && (user.managedSalespersonIds || []).includes(room.slice(5)))));
      if (isAllowed) {
        socket.join(room);
        socket.emit('subscribed:room', { room, status: 'ok' });
      } else {
        socket.emit('error', { message: 'Unauthorized room subscription attempt', room });
      }
    });

    socket.on('disconnect', () => socketRateLimits.delete(socket.id));
  });

  setIO(io);
  return io;
}

/**
 * Multi-instance mode: route every emit (rooms, disconnectSockets) through Redis pub/sub so a
 * location update received by one instance reaches dashboards connected to another.
 */
export async function attachRedisAdapter(io: SocketIOServer): Promise<boolean> {
  if (!redisEnabled()) return false;
  const pub = newRedisClient();
  const sub = pub.duplicate();
  sub.on('error', (err) => console.error('[redis:sub]', err.message));
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub, { key: 'salesgrid:socket.io' }));
  return true;
}
