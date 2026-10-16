import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// GET /api/notifications
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  const notifications = await prisma.notification.findMany({
    where: {
      OR: [
        { recipientId: user.id },
        { role: user.role },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  res.json({
    unreadCount,
    data: notifications,
  });
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  await prisma.notification.update({
    where: { id },
    data: { read: true },
  });

  res.json({ message: 'Marked as read' });
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  await prisma.notification.updateMany({
    where: {
      OR: [
        { recipientId: user.id },
        { role: user.role },
      ],
      read: false,
    },
    data: { read: true },
  });

  res.json({ message: 'All notifications marked as read' });
});

export default router;
