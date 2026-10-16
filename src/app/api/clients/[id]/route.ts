import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { getAuthorizedSalespersonIds } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ id: string }>({}, async ({ user, params }) => {
  const ids = getAuthorizedSalespersonIds(user);
  // Related history is limited to the caller's scope (a salesperson sees their own orders etc.).
  const spFilter = ids === undefined ? {} : { salespersonId: { in: ids } };

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      assignments: {
        include: {
          salesperson: { include: { user: { select: { name: true, phone: true } } } },
          assignedUser: { select: { name: true } },
        },
        orderBy: { assignedAt: 'desc' },
      },
      orders: {
        where: spFilter,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, orderNumber: true, grandTotal: true, status: true, createdAt: true, salesperson: { select: { user: { select: { name: true } } } } },
      },
      payments: {
        where: spFilter,
        orderBy: { collectedAt: 'desc' },
        take: 10,
        select: { id: true, receiptNumber: true, amount: true, paymentMethod: true, status: true, collectedAt: true, salesperson: { select: { user: { select: { name: true } } } } },
      },
      visits: {
        where: spFilter,
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: { id: true, startedAt: true, endedAt: true, distanceFromClient: true, outcome: true, notes: true, isException: true, salesperson: { select: { user: { select: { name: true } } } } },
      },
      ledgerEntries: { orderBy: { timestamp: 'desc' }, take: 15 },
    },
  });
  if (!client) return json({ error: 'Client not found' }, 404);

  if (ids !== undefined && !client.assignments.some((a) => a.active && ids.includes(a.salespersonId))) {
    return json({ error: 'You are not authorized to view this client' }, 403);
  }
  return json({ data: client });
});
