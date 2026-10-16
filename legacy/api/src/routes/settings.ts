import { Router, Request, Response } from 'express';
import { prisma, Role } from '../db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

// GET /api/settings
router.get('/', authenticateToken, async (_req: Request, res: Response): Promise<void> => {
  const settings = await prisma.systemSetting.findMany({
    orderBy: { key: 'asc' },
  });
  res.json({ data: settings });
});

// PUT /api/settings
router.put('/', authenticateToken, requireRole(Role.SUPER_ADMIN), async (req: Request, res: Response): Promise<void> => {
  const { settings }: { settings: Array<{ key: string; value: string }> } = req.body;

  if (!Array.isArray(settings)) {
    res.status(400).json({ error: 'settings array required' });
    return;
  }

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: String(s.value) },
      create: { key: s.key, value: String(s.value) },
    });
  }

  await logAuditEvent({
    req,
    action: 'UPDATE_SYSTEM_SETTINGS',
    module: 'SETTINGS',
    newValue: settings,
  });

  res.json({ message: 'Settings updated successfully' });
});

// GET /api/settings/permissions
router.get('/permissions', authenticateToken, requireRole(Role.SUPER_ADMIN), async (_req: Request, res: Response): Promise<void> => {
  const permissions = await prisma.managerPermission.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
  res.json({ data: permissions });
});

// PUT /api/settings/permissions/:userId
router.put('/permissions/:userId', authenticateToken, requireRole(Role.SUPER_ADMIN), async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const perms = req.body;

  const updated = await prisma.managerPermission.upsert({
    where: { userId },
    update: perms,
    create: {
      userId,
      ...perms,
    },
  });

  await logAuditEvent({
    req,
    action: 'UPDATE_MANAGER_PERMISSIONS',
    module: 'PERMISSIONS',
    recordId: userId,
    newValue: perms,
  });

  res.json({ data: updated });
});

export default router;
