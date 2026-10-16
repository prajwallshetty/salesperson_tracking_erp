import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma, Role, SalespersonStatus, UserStatus } from '../db';
import { authenticateToken, getAuthorizedSalespersonIds, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

// GET all salespersons (role & manager team scoped)
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const authorizedIds = getAuthorizedSalespersonIds(req.user!);

  const whereClause: any = {};
  if (authorizedIds !== undefined) {
    whereClause.id = { in: authorizedIds };
  }

  const salespersons = await prisma.salesperson.findMany({
    where: whereClause,
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, status: true },
      },
      clientAssignments: {
        where: { active: true },
        select: { clientId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    data: salespersons.map((s) => ({
      id: s.id,
      userId: s.userId,
      employeeCode: s.employeeCode,
      name: s.user.name,
      email: s.user.email,
      phone: s.user.phone,
      userStatus: s.user.status,
      territory: s.territory,
      dutyStatus: s.status,
      deviceId: s.deviceId,
      assignedClientsCount: s.clientAssignments.length,
      joiningDate: s.joiningDate,
    })),
  });
});

// GET /api/salespersons/live-status (Section 15)
router.get('/live-status', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const authorizedIds = getAuthorizedSalespersonIds(req.user!);

  const whereClause: any = {};
  if (authorizedIds !== undefined) {
    whereClause.id = { in: authorizedIds };
  }

  const salespersons = await prisma.salesperson.findMany({
    where: whereClause,
    include: {
      user: { select: { name: true, phone: true } },
      locationPoints: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
      attendances: {
        orderBy: { loginAt: 'desc' },
        take: 1,
      },
    },
  });

  const statuses = salespersons.map((s) => {
    const lastPoint = s.locationPoints[0];
    const latestAttendance = s.attendances[0];

    let lastUpdateFormatted = 'No GPS recorded';
    let minutesAgo = null;
    if (lastPoint) {
      const diffMs = Date.now() - new Date(lastPoint.timestamp).getTime();
      minutesAgo = Math.floor(diffMs / 60000);
      if (minutesAgo < 1) lastUpdateFormatted = 'Just now';
      else if (minutesAgo === 1) lastUpdateFormatted = '1 min ago';
      else if (minutesAgo < 60) lastUpdateFormatted = `${minutesAgo} mins ago`;
      else lastUpdateFormatted = `${Math.floor(minutesAgo / 60)}h ago`;
    }

    return {
      id: s.id,
      salespersonName: s.user.name,
      employeeCode: s.employeeCode,
      phone: s.user.phone,
      dutyStatus: s.status,
      territory: s.territory,
      lastLatitude: lastPoint?.latitude || null,
      lastLongitude: lastPoint?.longitude || null,
      accuracy: lastPoint?.accuracy || null,
      speed: lastPoint?.speed || 0,
      batteryLevel: lastPoint?.batteryLevel || null,
      networkType: lastPoint?.networkType || '4G',
      lastUpdate: lastPoint?.timestamp || null,
      lastUpdateFormatted,
      loginAt: latestAttendance?.loginAt || null,
      logoutAt: latestAttendance?.logoutAt || null,
    };
  });

  res.json({ data: statuses });
});

// GET /api/salespersons/dashboard (Section 4: Salesperson mobile home dashboard)
router.get('/dashboard', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const salespersonId = req.user?.salespersonId;
  if (!salespersonId && req.user?.role !== Role.SUPER_ADMIN) {
    res.status(403).json({ error: 'Salesperson profile not found for user' });
    return;
  }

  const targetSalespersonId = (req.query.salespersonId as string) || salespersonId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Today's Orders
  const todayOrders = await prisma.order.findMany({
    where: {
      salespersonId: targetSalespersonId,
      createdAt: { gte: today },
    },
    select: { grandTotal: true },
  });

  const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);

  // Today's Collections
  const todayCollections = await prisma.payment.findMany({
    where: {
      salespersonId: targetSalespersonId,
      collectedAt: { gte: today },
    },
    select: { amount: true, status: true },
  });

  const verifiedCollections = todayCollections
    .filter((p) => p.status === 'VERIFIED')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const pendingCollections = todayCollections
    .filter((p) => p.status === 'PENDING')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  // Clients Visited Today
  const todayVisits = await prisma.clientVisit.findMany({
    where: {
      salespersonId: targetSalespersonId,
      startedAt: { gte: today },
    },
    select: { clientId: true },
  });
  const uniqueVisitedClients = new Set(todayVisits.map((v) => v.clientId)).size;

  // Assigned Clients Total
  const assignedClientsCount = await prisma.clientAssignment.count({
    where: {
      salespersonId: targetSalespersonId,
      active: true,
    },
  });

  // Current Attendance Session
  const activeAttendance = await prisma.attendance.findFirst({
    where: {
      salespersonId: targetSalespersonId,
      status: 'ON_DUTY',
    },
    orderBy: { loginAt: 'desc' },
  });

  // Total Outstanding for assigned clients
  const assignedClients = await prisma.clientAssignment.findMany({
    where: { salespersonId: targetSalespersonId, active: true },
    select: { client: { select: { currentOutstanding: true } } },
  });
  const totalAssignedOutstanding = assignedClients.reduce(
    (sum, c) => sum + Number(c.client.currentOutstanding),
    0
  );

  res.json({
    todaySales,
    ordersCount: todayOrders.length,
    verifiedCollections,
    pendingCollections,
    totalCollectionsToday: verifiedCollections + pendingCollections,
    clientsVisited: uniqueVisitedClients,
    totalAssignedClients: assignedClientsCount,
    totalAssignedOutstanding,
    dutyStatus: activeAttendance ? 'ON_DUTY' : 'OFF_DUTY',
    loginTime: activeAttendance?.loginAt || null,
  });
});

// GET /api/salespersons/:id/performance (Section 13)
router.get('/:id/performance', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const authorizedIds = getAuthorizedSalespersonIds(req.user!);

  if (authorizedIds !== undefined && !authorizedIds.includes(id)) {
    res.status(403).json({ error: 'Access denied to this salesperson performance data' });
    return;
  }

  const { range = 'this_month', from, to } = req.query;

  let startDate = new Date();
  let endDate = new Date();

  if (range === 'today') {
    startDate.setHours(0, 0, 0, 0);
  } else if (range === 'this_week') {
    const day = startDate.getDay();
    const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
    startDate = new Date(startDate.setDate(diff));
    startDate.setHours(0, 0, 0, 0);
  } else if (range === 'this_month') {
    startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  } else if (range === 'custom' && from && to) {
    startDate = new Date(from as string);
    endDate = new Date(to as string);
    endDate.setHours(23, 59, 59, 999);
  }

  // Aggregate orders
  const orders = await prisma.order.findMany({
    where: {
      salespersonId: id,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: { grandTotal: true },
  });
  const totalSales = orders.reduce((sum, o) => sum + Number(o.grandTotal), 0);

  // Aggregate collections
  const payments = await prisma.payment.findMany({
    where: {
      salespersonId: id,
      collectedAt: { gte: startDate, lte: endDate },
      status: 'VERIFIED',
    },
    select: { amount: true },
  });
  const totalCollections = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  // Visits
  const visitsCount = await prisma.clientVisit.count({
    where: {
      salespersonId: id,
      startedAt: { gte: startDate, lte: endDate },
    },
  });

  // Attendance days & distance
  const attendances = await prisma.attendance.findMany({
    where: {
      salespersonId: id,
      date: { gte: startDate, lte: endDate },
    },
    select: { distanceTravelled: true },
  });
  const workingDays = attendances.length;
  const totalDistance = attendances.reduce((sum, a) => sum + a.distanceTravelled, 0);

  res.json({
    salespersonId: id,
    period: { range, from: startDate.toISOString(), to: endDate.toISOString() },
    totalSales,
    ordersCount: orders.length,
    totalCollections,
    clientsVisited: visitsCount,
    distanceKm: Number(totalDistance.toFixed(1)),
    workingDays,
  });
});

// POST create salesperson (Admin or Manager with permission)
router.post('/', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const { name, email, phone, password, employeeCode, territory, managerId } = req.body;

  if (!name || !email || !phone || !password || !employeeCode || !territory) {
    res.status(400).json({ error: 'Missing required salesperson fields' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash,
        role: Role.SALESPERSON,
        status: UserStatus.ACTIVE,
      },
    });

    const salesperson = await tx.salesperson.create({
      data: {
        userId: user.id,
        employeeCode,
        territory,
        status: SalespersonStatus.OFF_DUTY,
      },
    });

    if (managerId) {
      await tx.managerSalesperson.create({
        data: {
          managerId,
          salespersonId: salesperson.id,
        },
      });
    }

    return { user, salesperson };
  });

  await logAuditEvent({
    req,
    action: 'CREATE_SALESPERSON',
    module: 'SALESPERSON',
    recordId: result.salesperson.id,
    newValue: { name, employeeCode, territory },
  });

  res.status(201).json({ data: result.salesperson });
});

export default router;
