import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { notificationScope } from '@/lib/services/notifications';

export const dynamic = 'force-dynamic';

export const PUT = authedRoute({}, async ({ user }) => {
  await prisma.notification.updateMany({ where: { AND: [notificationScope(user), { read: false }] }, data: { read: true } });
  return json({ message: 'All notifications marked as read' });
});
