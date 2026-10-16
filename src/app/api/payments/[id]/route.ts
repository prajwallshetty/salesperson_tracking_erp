import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { canAccessSalesperson } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export const GET = authedRoute<{ id: string }>({ managerPermission: 'canViewPayments' }, async ({ user, params }) => {
  const payment = await prisma.payment.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      salesperson: { include: { user: { select: { name: true, phone: true } } } },
      verifiedBy: { select: { name: true } },
      order: true,
    },
  });
  if (!payment) return json({ error: 'Payment record not found' }, 404);
  if (!canAccessSalesperson(user, payment.salespersonId)) return json({ error: 'Access denied to this payment' }, 403);
  return json({ data: payment });
});
