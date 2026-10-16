import { prisma, Role, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER] }, async ({ user }) => {
  const userFilter: Prisma.UserWhereInput =
    user.role === Role.MANAGER ? { salespersonProfile: { id: { in: user.managedSalespersonIds || [] } } } : {};

  const codes = await prisma.userAccessCode.findMany({
    where: { user: userFilter },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, phone: true, role: true, status: true,
          salespersonProfile: { select: { id: true, employeeCode: true, territory: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return json({
    data: codes.map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.user.name,
      userEmail: c.user.email,
      userPhone: c.user.phone,
      employeeCode: c.user.salespersonProfile?.employeeCode || null,
      territory: c.user.salespersonProfile?.territory || null,
      role: c.user.role,
      userStatus: c.user.status,
      displayHint: c.displayHint,
      status: c.status,
      expiresAt: c.expiresAt?.toISOString() || null,
      failedAttempts: c.failedAttempts,
      isLocked: Boolean(c.lockedUntil && c.lockedUntil > new Date()),
      lockedUntil: c.lockedUntil?.toISOString() || null,
      lastUsedAt: c.lastUsedAt?.toISOString() || null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});
