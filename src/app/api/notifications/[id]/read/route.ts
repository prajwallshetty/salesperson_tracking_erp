import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { notificationScope } from '@/lib/services/notifications';

export const dynamic = 'force-dynamic';

export const PUT = authedRoute<{ id: string }>({}, async ({ user, params }) => {
  const res = await prisma.notification.updateMany({ where: { AND: [{ id: params.id }, notificationScope(user)] }, data: { read: true } });
  if (res.count === 0) return json({ error: 'Record not found' }, 404);
  return json({ message: 'Marked as read' });
});
