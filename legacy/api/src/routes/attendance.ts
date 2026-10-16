import { Router, Request, Response } from 'express';
import { prisma, Role, AttendanceStatus, SalespersonStatus } from '../db';
import { startAttendanceSchema, endAttendanceSchema, calculatePathDistanceKm } from '../shared';
import { authenticateToken, getAuthorizedSalespersonIds } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';
import { notifyAttendanceChange } from '../socket';

const router = Router();

// POST /api/attendance/start (Start Day)
router.post('/start', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = startAttendanceSchema.parse(req.body);
  const user = req.user!;

  const salespersonId = user.salespersonId;
  if (!salespersonId) {
    res.status(403).json({ error: 'Only salesperson accounts can start a duty session' });
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if already on duty today
  const existingActive = await prisma.attendance.findFirst({
    where: {
      salespersonId,
      status: AttendanceStatus.ON_DUTY,
    },
  });

  if (existingActive) {
    res.status(400).json({
      error: 'Salesperson is already ON DUTY with an active session',
      attendanceId: existingActive.id,
    });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // Create attendance
    const attendance = await tx.attendance.create({
      data: {
        salespersonId,
        date: today,
        loginAt: new Date(),
        loginLatitude: parsed.latitude,
        loginLongitude: parsed.longitude,
        status: AttendanceStatus.ON_DUTY,
      },
    });

    // Create location session
    const locationSession = await tx.locationSession.create({
      data: {
        salespersonId,
        attendanceId: attendance.id,
        startedAt: new Date(),
        status: 'ACTIVE',
      },
    });

    // If starting coordinates provided, store first breadcrumb
    if (parsed.latitude !== undefined && parsed.longitude !== undefined) {
      await tx.locationPoint.create({
        data: {
          sessionId: locationSession.id,
          salespersonId,
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          deviceId: parsed.deviceId,
          timestamp: new Date(),
        },
      });
    }

    // Set salesperson to ON_DUTY
    await tx.salesperson.update({
      where: { id: salespersonId },
      data: {
        status: SalespersonStatus.ON_DUTY,
        deviceId: parsed.deviceId,
      },
    });

    return { attendance, locationSession };
  });

  // Notify Admin
  await prisma.notification.create({
    data: {
      role: Role.SUPER_ADMIN,
      title: 'Salesperson Started Day',
      message: `${user.name} started work session at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
      type: 'ATTENDANCE',
    },
  });

  await logAuditEvent({
    req,
    action: 'START_DAY',
    module: 'ATTENDANCE',
    recordId: result.attendance.id,
    newValue: { salespersonId, loginAt: result.attendance.loginAt, lat: parsed.latitude, lng: parsed.longitude },
  });

  notifyAttendanceChange(salespersonId, {
    ...result.attendance,
    salespersonName: user.name,
    dutyStatus: 'ON_DUTY',
  });

  const responsePayload = {
    message: 'Work session started. Tracking enabled.',
    data: {
      attendanceId: result.attendance.id,
      sessionId: result.locationSession.id,
      loginAt: result.attendance.loginAt,
      status: 'ON_DUTY',
    },
  };

  if (parsed.idempotencyKey) {
    await prisma.idempotencyKey.create({
      data: {
        key: parsed.idempotencyKey,
        endpoint: '/api/attendance/start',
        salespersonId,
        responseCode: 201,
        responseBody: responsePayload,
      },
    });
  }

  res.status(201).json(responsePayload);
});

// POST /api/attendance/end (End Day)
router.post('/end', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = endAttendanceSchema.parse(req.body);
  const user = req.user!;

  const salespersonId = user.salespersonId;
  if (!salespersonId) {
    res.status(403).json({ error: 'Only salesperson accounts can end duty session' });
    return;
  }

  // Find active attendance session
  const activeAttendance = await prisma.attendance.findFirst({
    where: {
      salespersonId,
      status: AttendanceStatus.ON_DUTY,
    },
    include: {
      sessions: {
        where: { status: 'ACTIVE' },
      },
    },
    orderBy: { loginAt: 'desc' },
  });

  if (!activeAttendance) {
    res.status(400).json({ error: 'No active ON DUTY attendance session found' });
    return;
  }

  const logoutTime = new Date();
  const loginTime = new Date(activeAttendance.loginAt);
  const workingMinutes = Math.max(0, Math.floor((logoutTime.getTime() - loginTime.getTime()) / 60000));

  // Compute distance from all points during this attendance
  const points = await prisma.locationPoint.findMany({
    where: {
      salespersonId,
      timestamp: { gte: loginTime, lte: logoutTime },
    },
    orderBy: { timestamp: 'asc' },
    select: { latitude: true, longitude: true, accuracy: true, timestamp: true },
  });

  const distanceKm = calculatePathDistanceKm(points);

  // Compute visits, orders, sales, collections for today's session
  const [visitsCount, orders, collections] = await Promise.all([
    prisma.clientVisit.count({
      where: {
        salespersonId,
        startedAt: { gte: loginTime, lte: logoutTime },
      },
    }),
    prisma.order.findMany({
      where: {
        salespersonId,
        createdAt: { gte: loginTime, lte: logoutTime },
      },
      select: { grandTotal: true },
    }),
    prisma.payment.findMany({
      where: {
        salespersonId,
        collectedAt: { gte: loginTime, lte: logoutTime },
      },
      select: { amount: true, status: true },
    }),
  ]);

  const totalSales = orders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
  const verifiedCollections = collections
    .filter((c) => c.status === 'VERIFIED')
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const pendingCollections = collections
    .filter((c) => c.status === 'PENDING')
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Transaction to close sessions & update status
  await prisma.$transaction(async (tx) => {
    // Close active location sessions
    await tx.locationSession.updateMany({
      where: { attendanceId: activeAttendance.id, status: 'ACTIVE' },
      data: {
        status: 'ENDED',
        endedAt: logoutTime,
      },
    });

    // Update attendance record
    await tx.attendance.update({
      where: { id: activeAttendance.id },
      data: {
        logoutAt: logoutTime,
        logoutLatitude: parsed.latitude,
        logoutLongitude: parsed.longitude,
        workingMinutes,
        distanceTravelled: distanceKm,
        status: AttendanceStatus.COMPLETED,
      },
    });

    // Set salesperson to OFF_DUTY
    await tx.salesperson.update({
      where: { id: salespersonId },
      data: { status: SalespersonStatus.OFF_DUTY },
    });
  });

  notifyAttendanceChange(salespersonId, {
    id: activeAttendance.id,
    status: 'COMPLETED',
    dutyStatus: 'OFF_DUTY',
    logoutAt: logoutTime,
    workingMinutes,
    distanceKm,
  });

  const hours = Math.floor(workingMinutes / 60);
  const mins = workingMinutes % 60;
  const workingTimeFormatted = `${hours}h ${mins}m`;

  const dailySummary = {
    loginTime: activeAttendance.loginAt,
    logoutTime,
    workingTimeFormatted,
    workingMinutes,
    distanceKm,
    clientsVisited: visitsCount,
    ordersCount: orders.length,
    totalSales,
    verifiedCollections,
    pendingCollections,
    totalCollections: verifiedCollections + pendingCollections,
  };

  await logAuditEvent({
    req,
    action: 'END_DAY',
    module: 'ATTENDANCE',
    recordId: activeAttendance.id,
    newValue: dailySummary,
  });

  res.json({
    message: 'Work session completed. Tracking ended.',
    data: dailySummary,
  });
});

// GET /api/attendance/today
router.get('/today', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const salespersonId = req.user?.salespersonId;
  if (!salespersonId) {
    res.status(400).json({ error: 'Salesperson ID required' });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const attendance = await prisma.attendance.findFirst({
    where: {
      salespersonId,
      date: today,
    },
    orderBy: { loginAt: 'desc' },
  });

  res.json({ data: attendance });
});

// GET /api/attendance/history (Admin/Manager filterable)
router.get('/history', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { salespersonId, from, to, limit = 50, offset = 0 } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (from || to) {
    whereClause.date = {};
    if (from) whereClause.date.gte = new Date(from as string);
    if (to) whereClause.date.lte = new Date(to as string);
  }

  const [total, attendances] = await Promise.all([
    prisma.attendance.count({ where: whereClause }),
    prisma.attendance.findMany({
      where: whereClause,
      include: {
        salesperson: {
          select: {
            employeeCode: true,
            territory: true,
            user: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
      skip: Number(offset),
      take: Number(limit),
    }),
  ]);

  res.json({
    total,
    data: attendances.map((a) => ({
      id: a.id,
      salespersonId: a.salespersonId,
      salespersonName: a.salesperson.user.name,
      employeeCode: a.salesperson.employeeCode,
      territory: a.salesperson.territory,
      date: a.date,
      loginAt: a.loginAt,
      logoutAt: a.logoutAt,
      workingMinutes: a.workingMinutes,
      distanceKm: a.distanceTravelled,
      status: a.status,
    })),
  });
});

export default router;
