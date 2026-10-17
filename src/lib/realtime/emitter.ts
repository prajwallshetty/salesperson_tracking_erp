import { randomUUID } from 'crypto';
import type { Server as SocketIOServer } from 'socket.io';
import { SOCKET_EVENTS } from '@/lib/domain/constants';
import { currentTenantId } from '@/lib/db/tenancy';
import { rooms } from './rooms';

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
  const t = currentTenantId(); // always the tenant of the request that produced the change
  if (salespersonId) io.to(rooms.team(salespersonId)).to(rooms.admins(t)).emit(event, envelope);
  else io.to(rooms.admins(t)).to(rooms.managers(t)).emit(event, envelope);
}

export const notifySalespersonLocation = (salespersonId: string, point: unknown) =>
  emitToTeam(SOCKET_EVENTS.LOCATION_UPDATE, salespersonId, { salespersonId, point });

export const notifyTrackingState = (salespersonId: string, state: unknown) =>
  emitToTeam(SOCKET_EVENTS.TRACKING_STATE, salespersonId, { salespersonId, ...(state as object) });

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

/** Tenant-wide broadcast (every connected user of the current company). Payloads are ids only: clients refetch what they may see. */
function emitToTenant(event: string, data: unknown) {
  const io = getIO();
  if (!io) return;
  io.to(rooms.tenant(currentTenantId())).emit(event, createEnvelope(event, plain(data)));
}

export const notifyProductChanged = (data: { id?: string; action: 'created' | 'updated' | 'category' }) => emitToTenant(SOCKET_EVENTS.PRODUCT_CHANGED, data);
export const notifyClientChanged = (data: { id: string; action: 'created' | 'updated' }) => emitToTenant(SOCKET_EVENTS.CLIENT_CHANGED, data);
export const notifySettingsChanged = (keys: string[]) => emitToTenant(SOCKET_EVENTS.SETTINGS_CHANGED, { keys });
export const notifyTeamChanged = (data: { salespersonId?: string; managerId?: string | null }) => emitToTenant(SOCKET_EVENTS.TEAM_CHANGED, data);

/** A manager's permissions changed: their open sessions reload them (the server already enforces the new set). */
export function notifyPermissionsChanged(userId: string) {
  const io = getIO();
  if (!io) return;
  io.to(rooms.user(userId)).emit(SOCKET_EVENTS.PERMISSIONS_CHANGED, createEnvelope(SOCKET_EVENTS.PERMISSIONS_CHANGED, {}));
}

/**
 * A manager's open sockets start receiving a newly added team member's room immediately (rooms are
 * otherwise joined only at connect). Works across instances with the Redis adapter.
 */
export function joinManagerToTeam(managerId: string, salespersonId: string) {
  getIO()?.in(rooms.user(managerId)).socketsJoin(rooms.team(salespersonId));
}

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
  const t = currentTenantId();
  if (recipientId) io.to(rooms.user(recipientId)).emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  else if (role === 'SUPER_ADMIN') io.to(rooms.admins(t)).emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  else if (role === 'MANAGER') io.to(rooms.managers(t)).emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
  else if (role === 'SALESPERSON') io.to(rooms.salespersons(t)).emit(SOCKET_EVENTS.NOTIFICATION_NEW, envelope);
}
