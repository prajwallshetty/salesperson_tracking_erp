import { z } from 'zod';
import { prisma } from '@/lib/db';
import { HttpError, badRequest } from '@/lib/http/errors';
import { findIdempotentResponse } from '@/lib/services/idempotency';
import type { AuditActor } from '@/lib/services/audit';
import type { AuthenticatedUser } from '@/lib/permissions';
import { createOrder } from '@/features/orders/service';
import { createPayment } from '@/features/payments/service';
import { startDay, endDay } from '@/features/attendance/service';
import { startVisit, endVisit } from '@/features/visits/service';
import { createExpense } from '@/features/expenses/service';
import { ingestLocationPoints } from '@/features/tracking/service';

/**
 * Offline outbox sync (legacy POST /api/sync/batch, same request/response contract).
 *
 * Legacy defect fixed: each item type had its own ad-hoc implementation (different order maths,
 * no stock deduction, no approval/cash-verification policy, END_DAY silently ignored). Every item
 * now goes through the same service as its online endpoint, with the item's idempotency key, so
 * an item synced twice — or first sent online and later replayed from the queue — is applied once.
 */

export const SYNC_ITEM_TYPES = ['START_DAY', 'END_DAY', 'VISIT_START', 'VISIT_END', 'ORDER', 'PAYMENT', 'GPS_BATCH', 'EXPENSE'] as const;

const syncItemSchema = z.object({
  localId: z.string().min(1),
  type: z.enum(SYNC_ITEM_TYPES),
  payload: z.record(z.any()).default({}),
  idempotencyKey: z.string().min(1).optional(),
});

export const syncBatchSchema = z.object({
  items: z.array(z.any()).max(200, 'A sync batch may contain at most 200 items'),
});

export interface SyncResult {
  localId: string;
  serverId?: string;
  status: 'SYNCED' | 'FAILED';
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serverIdFrom(body: any): string | undefined {
  return body?.data?.id || body?.data?.visitId || body?.data?.attendanceId || body?.serverId || body?.id;
}

function timestampFrom(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

/** A VISIT_END queued while offline references the local id of its VISIT_START. */
async function resolveVisitId(rawId: unknown, localToServer: Map<string, string>): Promise<string> {
  if (typeof rawId !== 'string' || !rawId) throw badRequest('visitId is required');
  if (localToServer.has(rawId)) return localToServer.get(rawId)!;
  if (UUID.test(rawId)) return rawId;
  const stored = await findIdempotentResponse(`visit-start-${rawId}`);
  const id = stored?.body?.data?.visitId;
  if (!id) throw badRequest('The visit this record belongs to has not been synchronised yet');
  return id;
}

export async function processSyncBatch(user: AuthenticatedUser, rawItems: unknown[], actor: AuditActor): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const localToServer = new Map<string, string>();

  for (const raw of rawItems) {
    const localId = (raw as any)?.localId ? String((raw as any).localId) : 'unknown';
    const parsed = syncItemSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ localId, status: 'FAILED', error: parsed.error.errors[0]?.message || 'Invalid sync item' });
      continue;
    }
    const item = parsed.data;
    const key = item.idempotencyKey;
    const p = item.payload;

    try {
      let serverId: string | undefined;
      switch (item.type) {
        case 'START_DAY': {
          const r = await startDay(user, { latitude: p.latitude, longitude: p.longitude, deviceId: p.deviceId, idempotencyKey: key }, actor, {
            at: timestampFrom(p.timestamp),
            endpoint: '/api/sync/batch',
            tolerateActive: true,
          });
          serverId = serverIdFrom(r.body);
          break;
        }
        case 'END_DAY': {
          const replay = await findIdempotentResponse(key);
          if (replay) {
            serverId = serverIdFrom(replay.body);
            break;
          }
          const active = await prisma.attendance.findFirst({ where: { salespersonId: user.salespersonId, status: 'ON_DUTY' }, select: { id: true } });
          if (active) {
            await endDay(user, { latitude: p.latitude, longitude: p.longitude }, actor, { at: timestampFrom(p.timestamp) });
            serverId = active.id;
          }
          // No active session: the day was already ended (online or by an earlier sync) — nothing to do.
          if (key) {
            await prisma.idempotencyKey.create({
              data: { key, endpoint: '/api/sync/batch', salespersonId: user.salespersonId, responseCode: 200, responseBody: { serverId: serverId ?? null } },
            });
          }
          break;
        }
        case 'GPS_BATCH': {
          const r = await ingestLocationPoints(user, { sessionId: p.sessionId, points: p.points }, { requireOnDuty: false });
          serverId = r.sessionId;
          break;
        }
        case 'VISIT_START': {
          const r = await startVisit(
            user,
            { clientId: p.clientId, latitude: p.latitude, longitude: p.longitude, isException: p.isException, exceptionReason: p.exceptionReason ?? undefined, idempotencyKey: key },
            actor,
            { at: timestampFrom(p.startedAt), endpoint: '/api/sync/batch' }
          );
          serverId = serverIdFrom(r.body);
          if (serverId) {
            localToServer.set(item.localId, serverId);
            if (typeof p.localVisitId === 'string') localToServer.set(p.localVisitId, serverId);
          }
          break;
        }
        case 'VISIT_END': {
          const replay = await findIdempotentResponse(key);
          if (replay) {
            serverId = serverIdFrom(replay.body);
            break;
          }
          const visitId = await resolveVisitId(p.visitId, localToServer);
          const r = await endVisit(user, visitId, { outcome: p.outcome, notes: p.notes, photoUrl: p.photoUrl, signatureUrl: p.signatureUrl, voiceNoteUrl: p.voiceNoteUrl }, actor, {
            at: timestampFrom(p.endedAt),
          });
          serverId = serverIdFrom(r.body);
          if (key) {
            await prisma.idempotencyKey.create({
              data: { key, endpoint: '/api/sync/batch', salespersonId: user.salespersonId, responseCode: 200, responseBody: { serverId: serverId ?? null } },
            });
          }
          break;
        }
        case 'ORDER': {
          const r = await createOrder(user, { ...p, idempotencyKey: key ?? p.idempotencyKey }, actor, { endpoint: '/api/sync/batch' });
          serverId = serverIdFrom(r.body);
          break;
        }
        case 'PAYMENT': {
          const r = await createPayment(user, { ...p, idempotencyKey: key ?? p.idempotencyKey }, actor, { endpoint: '/api/sync/batch' });
          serverId = serverIdFrom(r.body);
          break;
        }
        case 'EXPENSE': {
          // Older clients sent `isSubmit` instead of `status` (offline claims were then saved as DRAFT).
          const status = p.status === 'SUBMITTED' || p.isSubmit === true ? 'SUBMITTED' : 'DRAFT';
          const { isSubmit: _ignored, ...rest } = p;
          const r = await createExpense(user, { ...rest, status, offlineId: p.offlineId || item.localId }, actor, {
            historyAction: { submitted: 'SUBMITTED_OFFLINE', draft: 'DRAFT_OFFLINE', comment: 'Offline-synchronized expense claim' },
          });
          serverId = serverIdFrom(r.body);
          break;
        }
      }
      results.push({ localId: item.localId, serverId, status: 'SYNCED' });
    } catch (err) {
      const message =
        err instanceof HttpError
          ? err.message
          : err instanceof z.ZodError
            ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
            : 'Sync failed';
      if (!(err instanceof HttpError) && !(err instanceof z.ZodError)) console.error(`Sync error for item ${item.localId}:`, err);
      results.push({ localId: item.localId, status: 'FAILED', error: message });
    }
  }
  return results;
}
