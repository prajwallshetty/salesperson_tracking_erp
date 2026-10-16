import { prisma, VisitOutcome, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { pagination, searchParams } from '@/lib/http/request';
import { scopedSalespersonFilter } from '@/lib/permissions';
import { parseDateRange } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ req, user }) => {
  const sp = searchParams(req);
  const { limit, offset } = pagination(sp, { limit: 50, max: 500 });
  const where: Prisma.ClientVisitWhereInput = {};
  if (sp.get('clientId')) where.clientId = sp.get('clientId')!;
  const outcome = sp.get('outcome');
  if (outcome && (Object.values(VisitOutcome) as string[]).includes(outcome)) where.outcome = outcome as VisitOutcome;
  const spFilter = scopedSalespersonFilter(user, sp.get('salespersonId'));
  if (spFilter !== undefined) where.salespersonId = spFilter;
  const range = parseDateRange(sp.get('from'), sp.get('to'));
  if (range) where.startedAt = range;
  if (sp.get('open') === 'true') where.endedAt = null;

  const [total, visits] = await Promise.all([
    prisma.clientVisit.count({ where }),
    prisma.clientVisit.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, city: true, address: true } },
        salesperson: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
      },
      orderBy: { startedAt: 'desc' },
      skip: offset,
      take: limit,
    }),
  ]);

  return json({
    total,
    data: visits.map((v) => ({
      id: v.id,
      clientId: v.clientId,
      clientName: v.client.name,
      clientAddress: v.client.address,
      salespersonId: v.salespersonId,
      salespersonName: v.salesperson.user.name,
      salespersonCode: v.salesperson.employeeCode,
      startedAt: v.startedAt,
      endedAt: v.endedAt,
      distanceFromClient: v.distanceFromClient,
      isException: v.isException,
      exceptionReason: v.exceptionReason,
      outcome: v.outcome,
      notes: v.notes,
      photoUrl: v.photoUrl,
      signatureUrl: v.signatureUrl,
    })),
  });
});
