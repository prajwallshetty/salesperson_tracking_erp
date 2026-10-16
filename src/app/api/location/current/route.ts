import { prisma, SalespersonStatus, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { getAuthorizedSalespersonIds } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/** A salesperson is "online" only if on duty with an accepted fix in the last 10 minutes. */
const ONLINE_WINDOW_MS = 10 * 60 * 1000;

export const GET = authedRoute({ managerPermission: 'canViewGps' }, async ({ user }) => {
  const ids = getAuthorizedSalespersonIds(user);
  const where: Prisma.SalespersonWhereInput = ids === undefined ? {} : { id: { in: ids } };

  const salespersons = await prisma.salesperson.findMany({
    where,
    include: {
      user: { select: { name: true, phone: true } },
      // Legacy included inactive (historical) assignments here.
      clientAssignments: {
        where: { active: true },
        include: { client: { select: { id: true, name: true, latitude: true, longitude: true, currentOutstanding: true } } },
      },
      locationPoints: { where: { isFiltered: false }, orderBy: { timestamp: 'desc' }, take: 1 },
    },
  });

  const now = Date.now();
  return json({
    data: salespersons.map((s) => {
      const last = s.locationPoints[0];
      const ageMs = last ? now - new Date(last.timestamp).getTime() : null;
      return {
        salespersonId: s.id,
        name: s.user.name,
        employeeCode: s.employeeCode,
        phone: s.user.phone,
        territory: s.territory,
        dutyStatus: s.status,
        isOnline: Boolean(s.status === SalespersonStatus.ON_DUTY && ageMs !== null && ageMs < ONLINE_WINDOW_MS),
        locationAgeSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
        currentLocation: last
          ? {
              latitude: last.latitude,
              longitude: last.longitude,
              accuracy: last.accuracy,
              speed: last.speed,
              heading: last.heading,
              batteryLevel: last.batteryLevel,
              timestamp: last.timestamp,
              isFiltered: last.isFiltered,
            }
          : null,
        assignedClients: s.clientAssignments.map((a) => ({
          id: a.client.id,
          name: a.client.name,
          latitude: a.client.latitude,
          longitude: a.client.longitude,
          outstanding: Number(a.client.currentOutstanding),
        })),
      };
    }),
  });
});
