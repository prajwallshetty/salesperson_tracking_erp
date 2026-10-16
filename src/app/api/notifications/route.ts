import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { notificationScope } from '@/lib/services/notifications';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ user }) => {
  const where = notificationScope(user);
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { ...where, read: false } }),
  ]);
  return json({ unreadCount, data: notifications });
});
