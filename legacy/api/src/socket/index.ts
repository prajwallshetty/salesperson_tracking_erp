import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma, UserStatus, Role } from '../db';
import { config } from '../config';
import { SOCKET_EVENTS } from '../shared';

let io: SocketIOServer | null = null;

// Track message rate-limits per socket connection
const socketRateLimits = new Map<string, { count: number; resetAt: number }>();

export interface RealtimeEnvelope<T = any> {
  eventId: string;
  version: number;
  timestamp: string;
  type: string;
  data: T;
}

export function createEnvelope<T>(type: string, data: T, version: number = 1): RealtimeEnvelope<T> {
  return {
    eventId: crypto.randomUUID(),
    version,
    timestamp: new Date().toISOString(),
    type,
    data,
  };
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  const allowedOrigins = new Set(config.corsOrigins);

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        if (config.nodeEnv !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    transports: ['websocket', 'polling'],
  });

  // Socket Authentication Middleware
  io.use(async (socket: Socket, next) => {
    try {
      const authHeader =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.query?.token;

      if (!authHeader) {
        return next(new Error('Authentication error: Missing token'));
      }

      const tokenString = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : String(authHeader);

      let decoded: any;
      try {
        decoded = jwt.verify(tokenString, config.jwtSecret);
      } catch (err) {
        return next(new Error('Authentication error: Invalid or expired token'));
      }

      const userId = decoded.userId || decoded.id;
      if (!userId) {
        return next(new Error('Authentication error: Malformed token payload'));
      }

      // Recheck user status & authority from database
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          salespersonProfile: true,
          managerPermissions: true,
          managedSalespersons: { select: { salespersonId: true } },
        },
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        return next(new Error('Authentication error: User account is inactive or revoked'));
      }

      socket.data.user = user;
      socket.data.userId = user.id;
      socket.data.role = user.role;
      socket.data.salespersonId = user.salespersonProfile?.id || null;
      socket.data.managedSalespersonIds = user.managedSalespersons.map((m) => m.salespersonId);

      return next();
    } catch (error) {
      console.error('Socket authentication exception:', error);
      return next(new Error('Internal server error during socket authentication'));
    }
  });

  // Connection Handler & Room Setup
  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const userId = user.id;
    const role = user.role;
    const salespersonId = socket.data.salespersonId;

    // Join personal user room
    socket.join(`user:${userId}`);

    // Role-scoped room assignment
    if (role === Role.SUPER_ADMIN) {
      socket.join('admins');
      socket.join('managers');
    } else if (role === Role.MANAGER) {
      socket.join('managers');
      socket.join(`manager:${userId}`);
      // Join team rooms for all managed salespersons
      for (const spId of socket.data.managedSalespersonIds || []) {
        socket.join(`team:${spId}`);
      }
    } else if (role === Role.SALESPERSON && salespersonId) {
      socket.join(`salesperson:${salespersonId}`);
      socket.join(`team:${salespersonId}`);
    }

    // Handle ping/heartbeat rate-limiting
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
        // Exceeded 120 messages per minute
        socket.emit('error', { message: 'Rate limit exceeded. Slow down.' });
        return;
      }

      socket.emit('pong:telemetry', {
        serverTime: new Date().toISOString(),
        received: payload,
      });
    });

    // Prevent unauthorized manual room subscriptions
    socket.on('subscribe:room', ({ room }) => {
      if (typeof room !== 'string') return;

      // Validate authorization
      const isAllowed =
        role === Role.SUPER_ADMIN ||
        room === `user:${userId}` ||
        (role === Role.SALESPERSON && (room === `salesperson:${salespersonId}` || room === `team:${salespersonId}`)) ||
        (role === Role.MANAGER && (room === 'managers' || room === `manager:${userId}` || (socket.data.managedSalespersonIds || []).includes(room.replace('team:', ''))));

      if (isAllowed) {
        socket.join(room);
        socket.emit('subscribed:room', { room, status: 'ok' });
      } else {
        socket.emit('error', { message: 'Unauthorized room subscription attempt', room });
      }
    });

    socket.on('disconnect', () => {
      socketRateLimits.delete(socket.id);
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

// ==================== REAL-TIME BROADCAST DISPATCHERS ====================

export function notifySalespersonLocation(salespersonId: string, point: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.LOCATION_UPDATE, {
    salespersonId,
    point,
  });
  io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.LOCATION_UPDATE, envelope);
}

export function notifyAttendanceChange(salespersonId: string, attendance: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.ATTENDANCE_CHANGED, {
    salespersonId,
    attendance,
  });
  io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.ATTENDANCE_CHANGED, envelope);
}

export function notifyOrderCreated(order: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.ORDER_CREATED, order);
  const salespersonId = order.salespersonId;
  if (salespersonId) {
    io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.ORDER_CREATED, envelope);
  } else {
    io.to('admins').to('managers').emit(SOCKET_EVENTS.ORDER_CREATED, envelope);
  }
}

export function notifyOrderStatusChanged(order: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.ORDER_STATUS_CHANGED, order);
  const salespersonId = order.salespersonId;
  if (salespersonId) {
    io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.ORDER_STATUS_CHANGED, envelope);
  } else {
    io.to('admins').to('managers').emit(SOCKET_EVENTS.ORDER_STATUS_CHANGED, envelope);
  }
}

export function notifyPaymentCollected(payment: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.PAYMENT_COLLECTED, payment);
  const salespersonId = payment.salespersonId;
  if (salespersonId) {
    io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.PAYMENT_COLLECTED, envelope);
  } else {
    io.to('admins').to('managers').emit(SOCKET_EVENTS.PAYMENT_COLLECTED, envelope);
  }
}

export function notifyPaymentVerified(payment: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.PAYMENT_VERIFIED, payment);
  const salespersonId = payment.salespersonId;
  if (salespersonId) {
    io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.PAYMENT_VERIFIED, envelope);
  } else {
    io.to('admins').to('managers').emit(SOCKET_EVENTS.PAYMENT_VERIFIED, envelope);
  }
}

export function notifyClientAssigned(salespersonId: string, assignment: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.CLIENT_ASSIGNED, {
    salespersonId,
    assignment,
  });
  io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.CLIENT_ASSIGNED, envelope);
}

export function notifyExpenseSubmitted(expense: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.EXPENSE_SUBMITTED, expense);
  const salespersonId = expense.salespersonId;
  io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.EXPENSE_SUBMITTED, envelope);
}

export function notifyExpenseApproved(expense: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.EXPENSE_APPROVED, expense);
  const salespersonId = expense.salespersonId;
  io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.EXPENSE_APPROVED, envelope);
}

export function notifyExpenseRejected(expense: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.EXPENSE_REJECTED, expense);
  const salespersonId = expense.salespersonId;
  io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.EXPENSE_REJECTED, envelope);
}

export function notifyExpenseReimbursed(expense: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.EXPENSE_REIMBURSED, expense);
  const salespersonId = expense.salespersonId;
  io.to(`team:${salespersonId}`).to('admins').emit(SOCKET_EVENTS.EXPENSE_REIMBURSED, envelope);
}

export function notifyInAppNotification(recipientId: string | null, role: Role | null, notification: any) {
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.NOTIFICATION_NEW, notification);
  if (recipientId) {
    io.to(`user:${recipientId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  } else if (role === Role.SUPER_ADMIN) {
    io.to('admins').emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  } else if (role === Role.MANAGER) {
    io.to('managers').emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  } else {
    io.emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  }
}
