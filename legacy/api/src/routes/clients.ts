import { Router, Request, Response } from 'express';
import { prisma, Role, AssignmentType, LedgerEntryType } from '../db';
import { clientCreateSchema, calculateHaversineDistanceMeters } from '../shared';
import { authenticateToken, getAuthorizedSalespersonIds, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

// GET /api/clients
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { search, category, status, pendingOnly, lat, lng, limit = 50, offset = 0 } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (search) {
    const s = String(search).toLowerCase();
    whereClause.OR = [
      { name: { contains: s, mode: 'insensitive' } },
      { contactPerson: { contains: s, mode: 'insensitive' } },
      { phone: { contains: s, mode: 'insensitive' } },
      { city: { contains: s, mode: 'insensitive' } },
    ];
  }

  if (category) {
    whereClause.category = String(category);
  }

  if (status) {
    whereClause.status = String(status);
  }

  if (pendingOnly === 'true') {
    whereClause.currentOutstanding = { gt: 0 };
  }

  // Record-level isolation for Salesperson or Manager
  if (authorizedSalespersonIds !== undefined) {
    whereClause.assignments = {
      some: {
        salespersonId: { in: authorizedSalespersonIds },
        active: true,
      },
    };
  }

  const [total, clients] = await Promise.all([
    prisma.client.count({ where: whereClause }),
    prisma.client.findMany({
      where: whereClause,
      include: {
        assignments: {
          where: { active: true },
          include: {
            salesperson: {
              include: { user: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
      skip: Number(offset),
      take: Number(limit),
    }),
  ]);

  const userLat = lat ? parseFloat(lat as string) : null;
  const userLng = lng ? parseFloat(lng as string) : null;

  const data = clients.map((c) => {
    let distanceMeters: number | undefined;
    if (userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng)) {
      distanceMeters = calculateHaversineDistanceMeters(userLat, userLng, c.latitude, c.longitude);
    }

    const primaryAssignment = c.assignments.find((a) => a.type === AssignmentType.PRIMARY);
    const backupAssignment = c.assignments.find((a) => a.type === AssignmentType.BACKUP);

    return {
      id: c.id,
      name: c.name,
      businessName: c.businessName,
      contactPerson: c.contactPerson,
      phone: c.phone,
      email: c.email,
      gstNumber: c.gstNumber,
      address: c.address,
      city: c.city,
      state: c.state,
      pincode: c.pincode,
      latitude: c.latitude,
      longitude: c.longitude,
      category: c.category,
      creditLimit: Number(c.creditLimit),
      paymentTerms: c.paymentTerms,
      status: c.status,
      notes: c.notes,
      openingBalance: Number(c.openingBalance),
      currentOutstanding: Number(c.currentOutstanding),
      primarySalesperson: primaryAssignment ? {
        id: primaryAssignment.salesperson.id,
        name: primaryAssignment.salesperson.user.name,
      } : null,
      backupSalesperson: backupAssignment ? {
        id: backupAssignment.salesperson.id,
        name: backupAssignment.salesperson.user.name,
      } : null,
      distanceMeters,
    };
  });

  // If user coordinates provided, optionally sort nearby
  if (userLat !== null && userLng !== null) {
    data.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));
  }

  res.json({ total, data });
});

// GET /api/clients/:id
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      assignments: {
        include: {
          salesperson: { include: { user: { select: { name: true, phone: true } } } },
          assignedUser: { select: { name: true } },
        },
        orderBy: { assignedAt: 'desc' },
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          grandTotal: true,
          status: true,
          createdAt: true,
          salesperson: { select: { user: { select: { name: true } } } },
        },
      },
      payments: {
        orderBy: { collectedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          paymentMethod: true,
          status: true,
          collectedAt: true,
          salesperson: { select: { user: { select: { name: true } } } },
        },
      },
      visits: {
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          distanceFromClient: true,
          outcome: true,
          notes: true,
          isException: true,
          salesperson: { select: { user: { select: { name: true } } } },
        },
      },
      ledgerEntries: {
        orderBy: { timestamp: 'desc' },
        take: 15,
      },
    },
  });

  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  // Authorization check for salesperson/manager
  if (authorizedSalespersonIds !== undefined) {
    const isAssigned = client.assignments.some(
      (a) => a.active && authorizedSalespersonIds.includes(a.salespersonId)
    );
    if (!isAssigned) {
      res.status(403).json({ error: 'You are not authorized to view this client' });
      return;
    }
  }

  res.json({ data: client });
});

// POST /api/clients (Create client)
router.post('/', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const parsed = clientCreateSchema.parse(req.body);

  const client = await prisma.$transaction(async (tx) => {
    const newClient = await tx.client.create({
      data: {
        name: parsed.name,
        businessName: parsed.businessName,
        contactPerson: parsed.contactPerson,
        phone: parsed.phone,
        email: parsed.email || null,
        gstNumber: parsed.gstNumber || null,
        address: parsed.address,
        city: parsed.city,
        state: parsed.state,
        pincode: parsed.pincode,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        category: parsed.category,
        creditLimit: parsed.creditLimit,
        paymentTerms: parsed.paymentTerms,
        notes: parsed.notes,
        openingBalance: parsed.openingBalance,
        currentOutstanding: parsed.openingBalance,
      },
    });

    if (parsed.openingBalance > 0) {
      await tx.clientLedgerEntry.create({
        data: {
          clientId: newClient.id,
          entryType: LedgerEntryType.OPENING_BALANCE,
          amount: parsed.openingBalance,
          runningBalance: parsed.openingBalance,
          description: 'Opening balance initialized',
        },
      });
    }

    if (parsed.assignedSalespersonId) {
      await tx.clientAssignment.create({
        data: {
          clientId: newClient.id,
          salespersonId: parsed.assignedSalespersonId,
          assignedBy: req.user!.id,
          type: AssignmentType.PRIMARY,
          active: true,
        },
      });
    }

    return newClient;
  });

  await logAuditEvent({
    req,
    action: 'CREATE_CLIENT',
    module: 'CLIENT',
    recordId: client.id,
    newValue: client,
  });

  res.status(201).json({ data: client });
});

// POST /api/clients/:id/assign (Section 7.2: Maintain assignment history)
router.post('/:id/assign', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { primarySalespersonId, backupSalespersonId, notes } = req.body;

  if (!primarySalespersonId) {
    res.status(400).json({ error: 'primarySalespersonId is required' });
    return;
  }

  const client = await prisma.client.findUnique({
    where: { id },
    include: { assignments: { where: { active: true } } },
  });

  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  const oldAssignments = client.assignments;

  await prisma.$transaction(async (tx) => {
    // Deactivate previous active assignments
    await tx.clientAssignment.updateMany({
      where: { clientId: id, active: true },
      data: { active: false },
    });

    // Create new primary
    await tx.clientAssignment.create({
      data: {
        clientId: id,
        salespersonId: primarySalespersonId,
        assignedBy: req.user!.id,
        type: AssignmentType.PRIMARY,
        active: true,
        notes,
      },
    });

    // Create optional backup
    if (backupSalespersonId) {
      await tx.clientAssignment.create({
        data: {
          clientId: id,
          salespersonId: backupSalespersonId,
          assignedBy: req.user!.id,
          type: AssignmentType.BACKUP,
          active: true,
          notes,
        },
      });
    }
  });

  // Notify assigned primary salesperson
  const primarySp = await prisma.salesperson.findUnique({
    where: { id: primarySalespersonId },
    select: { userId: true },
  });

  if (primarySp) {
    await prisma.notification.create({
      data: {
        recipientId: primarySp.userId,
        role: Role.SALESPERSON,
        title: 'Client Assigned',
        message: `${client.name} has been assigned to your territory.`,
        type: 'ASSIGNMENT',
      },
    });
  }

  await logAuditEvent({
    req,
    action: 'REASSIGN_CLIENT',
    module: 'CLIENT_ASSIGNMENT',
    recordId: id,
    oldValue: oldAssignments,
    newValue: { primarySalespersonId, backupSalespersonId, notes },
  });

  res.json({ message: 'Client assignment updated successfully' });
});

export default router;
