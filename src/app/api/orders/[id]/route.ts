import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { canAccessSalesperson } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ id: string }>({ managerPermission: 'canViewOrders' }, async ({ user, params }) => {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      salesperson: { include: { user: { select: { name: true, phone: true } } } },
      items: true,
      payments: true,
      approvedBy: { select: { name: true } },
    },
  });
  if (!order) return json({ error: 'Order not found' }, 404);
  if (!canAccessSalesperson(user, order.salespersonId)) return json({ error: 'Access denied to this order' }, 403);
  return json({ data: order });
});
