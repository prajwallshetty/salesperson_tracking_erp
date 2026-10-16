import { prisma, Role, VisitOutcome } from '@/lib/db';
import { startVisitSchema, endVisitSchema } from '@/lib/validations/schemas';
import { calculateHaversineDistanceMeters } from '@/lib/domain/geo';
import { badRequest, forbidden, notFound } from '@/lib/http/errors';
import { getAccessibleClient, assertSalespersonAccess } from '@/lib/services/access';
import { getVisitRadiusMeters } from '@/lib/services/settings';
import { findIdempotentResponse, storeIdempotentResponse, type StoredResponse } from '@/lib/services/idempotency';
import { isUniqueViolation } from '@/lib/services/numbering';
import { createNotification } from '@/lib/services/notifications';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import type { AuthenticatedUser } from '@/lib/permissions';

export async function startVisit(
  user: AuthenticatedUser,
  rawInput: unknown,
  actor: AuditActor,
  opts: { at?: Date; endpoint?: string } = {}
): Promise<StoredResponse> {
  const input = startVisitSchema.parse(rawInput);
  const salespersonId = user.salespersonId;
  if (!salespersonId) throw forbidden('Only salesperson accounts can initiate client visits');

  const replay = await findIdempotentResponse(input.idempotencyKey);
  if (replay) return replay;

  const client = await getAccessibleClient(user, input.clientId);

  // Distance is always computed server-side from reported GPS vs. the registered client location.
  const distanceMeters = calculateHaversineDistanceMeters(input.latitude, input.longitude, client.latitude, client.longitude);
  const maxRadiusMeters = await getVisitRadiusMeters();
  const isOutOfRadius = distanceMeters > maxRadiusMeters;
  const isException = isOutOfRadius || !!input.isException;
  const exceptionReason = isOutOfRadius
    ? input.exceptionReason || `Distance ${distanceMeters}m exceeded allowed radius of ${maxRadiusMeters}m`
    : input.exceptionReason;

  let body;
  try {
    body = await prisma.$transaction(async (tx) => {
      const visit = await tx.clientVisit.create({
        data: {
          clientId: input.clientId,
          salespersonId,
          startedAt: opts.at ?? new Date(),
          latitude: input.latitude,
          longitude: input.longitude,
          distanceFromClient: distanceMeters,
          isException,
          exceptionReason,
          outcome: VisitOutcome.FOLLOW_UP_REQUIRED,
        },
      });
      const responseBody = {
        message: 'Visit started successfully',
        data: { visitId: visit.id, distanceMeters, isException, exceptionReason, startedAt: visit.startedAt, maxRadiusMeters },
      };
      await storeIdempotentResponse(tx, input.idempotencyKey, { endpoint: opts.endpoint ?? '/api/visits/start', salespersonId, status: 201, body: responseBody });
      return responseBody;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const replayAfter = await findIdempotentResponse(input.idempotencyKey);
      if (replayAfter) return replayAfter;
    }
    throw err;
  }

  await logAuditEvent({
    actor,
    action: 'START_VISIT',
    module: 'VISIT',
    recordId: body.data.visitId,
    newValue: { clientId: client.id, distanceMeters, isException, exceptionReason },
  });
  return { status: 201, body: JSON.parse(JSON.stringify(body)) };
}

export async function endVisit(
  user: AuthenticatedUser,
  visitId: string,
  rawInput: unknown,
  actor: AuditActor,
  opts: { at?: Date } = {}
): Promise<StoredResponse> {
  const input = endVisitSchema.parse(rawInput);
  const visit = await prisma.clientVisit.findUnique({ where: { id: visitId }, include: { client: true } });
  if (!visit) throw notFound('Visit record not found');

  if (user.role === Role.SALESPERSON && user.salespersonId !== visit.salespersonId) {
    throw forbidden('Access denied: not your visit record');
  }
  assertSalespersonAccess(user, visit.salespersonId, 'Access denied: not your visit record');
  if (visit.endedAt) throw badRequest('Visit has already been completed');

  const updated = await prisma.clientVisit.update({
    where: { id: visitId },
    data: {
      endedAt: opts.at && opts.at > visit.startedAt ? opts.at : new Date(),
      outcome: input.outcome as VisitOutcome,
      notes: input.notes,
      photoUrl: input.photoUrl,
      signatureUrl: input.signatureUrl,
      voiceNoteUrl: input.voiceNoteUrl,
    },
  });

  await createNotification({
    role: Role.SUPER_ADMIN,
    title: 'Client Visit Completed',
    message: `${user.name} completed visit to ${visit.client.name}. Outcome: ${input.outcome}.`,
    type: 'VISIT',
  });
  await logAuditEvent({ actor, action: 'END_VISIT', module: 'VISIT', recordId: visitId, newValue: { outcome: input.outcome, notes: input.notes } });

  return { status: 200, body: { message: 'Visit completed', data: JSON.parse(JSON.stringify(updated)) } };
}
