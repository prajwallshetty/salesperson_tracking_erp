import { prisma, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { pagination, searchParams } from '@/lib/http/request';
import { scopedSalespersonFilter } from '@/lib/permissions';
import { parseDateOnlyRange } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ req, user }) => {
  const sp = searchParams(req);
  const { limit, offset } = pagination(sp, { limit: 50, max: 500 });
  const where: Prisma.AttendanceWhereInput = {};
  const spFilter = scopedSalespersonFilter(user, sp.get('salespersonId'));
  if (spFilter !== undefined) where.salespersonId = spFilter;
  const range = parseDateOnlyRange(sp.get('from'), sp.get('to'));
  if (range) where.date = range;

  const [total, rows] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      include: { salesperson: { select: { employeeCode: true, territory: true, user: { select: { name: true, phone: true } } } } },
      orderBy: [{ date: 'desc' }, { loginAt: 'desc' }],
      skip: offset,
      take: limit,
    }),
  ]);

  return json({
    total,
    data: rows.map((a) => ({
      id: a.id,
      salespersonId: a.salespersonId,
      salespersonName: a.salesperson.user.name,
      employeeCode: a.salesperson.employeeCode,
      territory: a.salesperson.territory,
      date: a.date,
      loginAt: a.loginAt,
      logoutAt: a.logoutAt,
      workingMinutes: a.workingMinutes,
      distanceKm: a.distanceTravelled,
      status: a.status,
    })),
  });
});
