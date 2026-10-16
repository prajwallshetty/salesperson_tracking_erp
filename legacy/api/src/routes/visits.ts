import { Router, Request, Response } from 'express';
import { prisma, Role, VisitOutcome } from '../db';
import { startVisitSchema, endVisitSchema, calculateHaversineDistanceMeters } from '../shared';
import { authenticateToken, getAuthorizedSalespersonIds } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

// GET /api/visits
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { clientId, salespersonId, from, to, outcome, limit = 50, offset = 0 } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (clientId) whereClause.clientId = String(clientId);
  if (outcome) whereClause.outcome = outcome as VisitOutcome;

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (from || to) {
    whereClause.startedAt = {};
    if (from) whereClause.startedAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.startedAt.lte = toDate;
    }
  }

  const [total, visits] = await Promise.all([
    prisma.clientVisit.count({ where: whereClause }),
    prisma.clientVisit.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true, address: true } },
        salesperson: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
      },
      orderBy: { startedAt: 'desc' },
      skip: Number(offset),
      take: Number(limit),
    }),
  ]);

  res.json({
    total,
    data: visits.map((v) => ({
      id: v.id,
      clientId: v.clientId,
      clientName: v.client.name,
      clientAddress: v.client.address,
      salespersonId: v.salespersonId,
      salespersonName: v.salesperson.user.name,
      salespersonCode: v.salesperson.employeeCode,
      startedAt: v.startedAt,
      endedAt: v.endedAt,
      distanceFromClient: v.distanceFromClient,
      isException: v.isException,
      exceptionReason: v.exceptionReason,
      outcome: v.outcome,
      notes: v.notes,
      photoUrl: v.photoUrl,
      signatureUrl: v.signatureUrl,
    })),
  });
});

// POST /api/visits/start (Section 8.1: Start Visit with GPS Evidence)
router.post('/start', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = startVisitSchema.parse(req.body);
  const user = req.user!;

  const salespersonId = user.salespersonId;
  if (!salespersonId) {
    res.status(403).json({ error: 'Only salesperson accounts can initiate client visits' });
    return;
  }

  // Idempotency check
  if (parsed.idempotencyKey) {
    const existingKey = await prisma.idempotencyKey.findUnique({
      where: { key: parsed.idempotencyKey },
    });
    if (existingKey) {
      res.status(existingKey.responseCode).json(existingKey.responseBody);
      return;
    }
  }

  const client = await prisma.client.findUnique({
    where: { id: parsed.clientId },
  });

  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  // Calculate distance between salesperson GPS and registered client location
  const distanceMeters = calculateHaversineDistanceMeters(
    parsed.latitude,
    parsed.longitude,
    client.latitude,
    client.longitude
  );

  // Retrieve configurable visit radius setting
  const radiusSetting = await prisma.systemSetting.findUnique({
    where: { key: 'visit_radius_meters' },
  });
  const maxRadiusMeters = radiusSetting ? parseInt(radiusSetting.value, 10) : 100;

  const isOutOfRadius = distanceMeters > maxRadiusMeters;
  const isException = isOutOfRadius || !!parsed.isException;
  const exceptionReason = isOutOfRadius
    ? (parsed.exceptionReason || `Distance ${distanceMeters}m exceeded allowed radius of ${maxRadiusMeters}m`)
    : parsed.exceptionReason;

  const visit = await prisma.clientVisit.create({
    data: {
      clientId: parsed.clientId,
      salespersonId,
      startedAt: new Date(),
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      distanceFromClient: distanceMeters,
      isException,
      exceptionReason,
      outcome: VisitOutcome.FOLLOW_UP_REQUIRED,
    },
    include: {
      client: { select: { name: true } },
    },
  });

  await logAuditEvent({
    req,
    action: 'START_VISIT',
    module: 'VISIT',
    recordId: visit.id,
    newValue: {
      clientId: client.id,
      distanceMeters,
      isException,
      exceptionReason,
    },
  });

  const responsePayload = {
    message: 'Visit started successfully',
    data: {
      visitId: visit.id,
      distanceMeters,
      isException,
      exceptionReason,
      startedAt: visit.startedAt,
    },
  };

  if (parsed.idempotencyKey) {
    await prisma.idempotencyKey.create({
      data: {
        key: parsed.idempotencyKey,
        endpoint: '/api/visits/start',
        salespersonId,
        responseCode: 201,
        responseBody: responsePayload,
      },
    });
  }

  res.status(201).json(responsePayload);
});

// POST /api/visits/:id/end (Section 8.2: Visit Outcome)
router.post('/:id/end', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const parsed = endVisitSchema.parse(req.body);
  const user = req.user!;

  const visit = await prisma.clientVisit.findUnique({
    where: { id },
    include: { client: true },
  });

  if (!visit) {
    res.status(404).json({ error: 'Visit record not found' });
    return;
  }

  if (user.role === Role.SALESPERSON && user.salespersonId !== visit.salespersonId) {
    res.status(403).json({ error: 'Access denied: not your visit record' });
    return;
  }

  const updatedVisit = await prisma.clientVisit.update({
    where: { id },
    data: {
      endedAt: new Date(),
      outcome: parsed.outcome,
      notes: parsed.notes,
      photoUrl: parsed.photoUrl,
      signatureUrl: parsed.signatureUrl,
      voiceNoteUrl: parsed.voiceNoteUrl,
    },
  });

  // Notify admin on visit completion
  await prisma.notification.create({
    data: {
      role: Role.SUPER_ADMIN,
      title: 'Client Visit Completed',
      message: `${user.name} completed visit to ${visit.client.name}. Outcome: ${parsed.outcome}.`,
      type: 'VISIT',
    },
  });

  await logAuditEvent({
    req,
    action: 'END_VISIT',
    module: 'VISIT',
    recordId: id,
    newValue: { outcome: parsed.outcome, notes: parsed.notes },
  });

  res.json({
    message: 'Visit completed',
    data: updatedVisit,
  });
});

export default router;
