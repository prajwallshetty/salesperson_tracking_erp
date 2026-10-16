import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { businessDateValue } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ user }) => {
  if (!user.salespersonId) return json({ error: 'Salesperson ID required' }, 400);
  const attendance = await prisma.attendance.findFirst({
    where: { salespersonId: user.salespersonId, date: businessDateValue() },
    orderBy: { loginAt: 'desc' },
  });
  return json({ data: attendance });
});
