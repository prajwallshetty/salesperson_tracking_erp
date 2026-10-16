import { Router, Request, Response } from 'express';
import { prisma, Role } from '../db';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// GET /api/audit-logs
router.get('/', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const { module, action, userId, from, to, search, limit = 50, offset = 0 } = req.query;

  const whereClause: any = {};

  if (module) whereClause.module = String(module);
  if (action) whereClause.action = String(action);
  if (userId) whereClause.userId = String(userId);

  if (from || to) {
    whereClause.createdAt = {};
    if (from) whereClause.createdAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.createdAt.lte = toDate;
    }
  }

  if (search) {
    const s = String(search).toLowerCase();
    whereClause.OR = [
      { action: { contains: s, mode: 'insensitive' } },
      { module: { contains: s, mode: 'insensitive' } },
      { recordId: { contains: s, mode: 'insensitive' } },
    ];
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where: whereClause }),
    prisma.auditLog.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, role: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: Number(offset),
      take: Number(limit),
    }),
  ]);

  res.json({
    total,
    data: logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      userName: l.user?.name || 'System',
      userRole: l.user?.role || 'SYSTEM',
      action: l.action,
      module: l.module,
      recordId: l.recordId,
      oldValue: l.oldValue,
      newValue: l.newValue,
      ip: l.ip,
      device: l.device,
      createdAt: l.createdAt,
    })),
  });
});

export default router;
