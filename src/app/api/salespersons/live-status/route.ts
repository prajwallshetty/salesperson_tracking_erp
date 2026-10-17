import { prisma, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { getAuthorizedSalespersonIds } from '@/lib/permissions';
import { formatFreshness } from '@/features/tracking/freshness';
import { computeLiveState } from '@/features/tracking/liveState';

export const dynamic = 'force-dynamic';


export const GET = authedRoute({ managerPermission: 'canViewGps' }, async ({ user }) => {
  const ids = getAuthorizedSalespersonIds(user);
  const where: Prisma.SalespersonWhereInput = ids === undefined ? {} : { id: { in: ids } };

  const salespersons = await prisma.salesperson.findMany({
    where,
    include: {
      user: { select: { name: true, phone: true } },
      // Latest *accepted* fix; filtered (implausible) points are never shown as a position.
      locationPoints: { where: { isFiltered: false }, orderBy: { timestamp: 'desc' }, take: 1 },
      attendances: { orderBy: { loginAt: 'desc' }, take: 1 },
    },
  });

  return json({
    data: salespersons.map((s) => {
      const last = s.locationPoints[0];
      const att = s.attendances[0];
      const fresh = formatFreshness(last?.timestamp);
      const live = computeLiveState({
        dutyStatus: s.status,
        lastFixAt: last?.timestamp,
        deviceState: s.trackingState,
        deviceStateAt: s.trackingStateAt,
      });
      return {
        id: s.id,
        salespersonName: s.user.name,
        employeeCode: s.employeeCode,
        phone: s.user.phone,
        dutyStatus: s.status,
        territory: s.territory,
        lastLatitude: last?.latitude ?? null,
        lastLongitude: last?.longitude ?? null,
        accuracy: last?.accuracy ?? null,
        // Reported values only — legacy substituted speed 0 and network "4G" when unknown.
        speed: last?.speed ?? null,
        batteryLevel: last?.batteryLevel ?? null,
        networkType: last?.networkType ?? null,
        lastUpdate: last?.timestamp ?? null,
        lastUpdateFormatted: fresh.label,
        minutesSinceUpdate: fresh.minutesAgo,
        // live | stale | unavailable | permission_denied | gps_disabled | off_duty — from the last REAL
        // accepted fix and what the phone itself reported; never extrapolated.
        liveState: live.state,
        liveStateLabel: live.label,
        backgroundLimited: live.backgroundLimited,
        deviceTrackingState: s.trackingState ?? null,
        deviceTrackingStateAt: s.trackingStateAt ?? null,
        deviceTrackingDetail: s.trackingDetail ?? null,
        loginAt: att?.loginAt ?? null,
        logoutAt: att?.logoutAt ?? null,
      };
    }),
  });
});
