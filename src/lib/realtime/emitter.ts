import { randomUUID } from 'crypto';
import type { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '@/lib/domain/constants';

/**
 * Realtime broadcast helpers. The Socket.IO server is created by `server.ts` and stored on
 * globalThis so Route Handlers (same Node process) can emit. When the app runs without the
 * custom server (e.g. `next dev` / serverless), these are no-ops and the UI falls back to polling.
 */

const g = globalThis as unknown as { __salesgridIO?: SocketIOServer | null };

export function setIO(io: SocketIOServer | null) {
  g.__salesgridIO = io;
}

export function getIO(): SocketIOServer | null {
  return g.__salesgridIO ?? null;
}

export interface RealtimeEnvelope<T = unknown> {
  eventId: string;
  version: number;
  timestamp: string;
  type: string;
  data: T;
}

export function createEnvelope<T>(type: string, data: T, version = 1): RealtimeEnvelope<T> {
  return { eventId: randomUUID(), version, timestamp: new Date().toISOString(), type, data };
}

// Decimal/Date values serialise like the JSON API does.
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function emitToTeam(event: string, salespersonId: string | undefined | null, data: unknown) {
  const io = getIO();
  if (!io) return;
  const envelope = createEnvelope(event, plain(data));
  if (salespersonId) io.to(`team:${salespersonId}`).to('admins').emit(event, envelope);
  else io.to('admins').to('managers').emit(event, envelope);
}

export const notifySalespersonLocation = (salespersonId: string, point: unknown) =>
  emitToTeam(SOCKET_EVENTS.LOCATION_UPDATE, salespersonId, { salespersonId, point });

export const notifyAttendanceChange = (salespersonId: string, attendance: unknown) =>
  emitToTeam(SOCKET_EVENTS.ATTENDANCE_CHANGED, salespersonId, { salespersonId, attendance });

export const notifyOrderCreated = (order: { salespersonId?: string } & Record<string, unknown>) =>
  emitToTeam(SOCKET_EVENTS.ORDER_CREATED, order.salespersonId, order);

export const notifyOrderStatusChanged = (order: { salespersonId?: string } & Record<string, unknown>) =>
  emitToTeam(SOCKET_EVENTS.ORDER_STATUS_CHANGED, order.salespersonId, order);

export const notifyPaymentCollected = (payment: { salespersonId?: string } & Record<string, unknown>) =>
  emitToTeam(SOCKET_EVENTS.PAYMENT_COLLECTED, payment.salespersonId, payment);

export const notifyPaymentVerified = (payment: { salespersonId?: string } & Record<string, unknown>) =>
  emitToTeam(SOCKET_EVENTS.PAYMENT_VERIFIED, payment.salespersonId, payment);

export const notifyClientAssigned = (salespersonId: string, assignment: unknown) =>
  emitToTeam(SOCKET_EVENTS.CLIENT_ASSIGNED, salespersonId, { salespersonId, assignment });

export const notifyExpenseEvent = (
  event: 'EXPENSE_SUBMITTED' | 'EXPENSE_APPROVED' | 'EXPENSE_REJECTED' | 'EXPENSE_REIMBURSED',
  expense: { salespersonId: string } & Record<string, unknown>
) => emitToTeam(SOCKET_EVENTS[event], expense.salespersonId, expense);

export function notifyInAppNotification(recipientId: string | null, role: string | null, notification: unknown) {
  const io = getIO();
  if (!io) return;
  const envelope = createEnvelope(SOCKET_EVENTS.NOTIFICATION_NEW, plain(notification));
  if (recipientId) io.to(`user:${recipientId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  else if (role === 'SUPER_ADMIN') io.to('admins').emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  else if (role === 'MANAGER') io.to('managers').emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  else if (role === 'SALESPERSON') io.to('salespersons').emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
}
