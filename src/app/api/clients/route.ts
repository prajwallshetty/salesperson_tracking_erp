import { prisma, AssignmentType, Role, type Prisma } from '@/lib/db';
import { calculateHaversineDistanceMeters } from '@/lib/domain/geo';
import { authedRoute, json } from '@/lib/http/handler';
import { pagination, readJson, searchParams } from '@/lib/http/request';
import { clientScopeFilter } from '@/lib/services/access';
import { actorFrom } from '@/lib/services/audit';
import { createClient } from '@/features/customers/service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({}, async ({ req, user }) => {
  const sp = searchParams(req);
  const { limit, offset } = pagination(sp, { limit: 50, max: 500 });
  const search = sp.get('search');
  const where: Prisma.ClientWhereInput = { ...clientScopeFilter(user) };
  if (search) {
    where.OR = ['name', 'contactPerson', 'phone', 'city', 'businessName'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' } }));
  }
  if (sp.get('category')) where.category = sp.get('category')!;
  if (sp.get('status')) where.status = sp.get('status')!;
  if (sp.get('pendingOnly') === 'true') where.currentOutstanding = { gt: 0 };

  const [total, clients] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      include: {
        assignments: { where: { active: true }, include: { salesperson: { include: { user: { select: { name: true } } } } } },
      },
      orderBy: { name: 'asc' },
      skip: offset,
      take: limit,
    }),
  ]);

  const lat = parseFloat(sp.get('lat') || '');
  const lng = parseFloat(sp.get('lng') || '');
  const hasCoords = !isNaN(lat) && !isNaN(lng);

  const data = clients.map((c) => {
    const primary = c.assignments.find((a) => a.type === AssignmentType.PRIMARY);
    const backup = c.assignments.find((a) => a.type === AssignmentType.BACKUP);
    return {
      id: c.id,
      name: c.name,
      businessName: c.businessName,
      contactPerson: c.contactPerson,
      phone: c.phone,
      email: c.email,
      gstNumber: c.gstNumber,
      address: c.address,
      city: c.city,
      state: c.state,
      pincode: c.pincode,
      latitude: c.latitude,
      longitude: c.longitude,
      category: c.category,
      creditLimit: Number(c.creditLimit),
      paymentTerms: c.paymentTerms,
      status: c.status,
      notes: c.notes,
      openingBalance: Number(c.openingBalance),
      currentOutstanding: Number(c.currentOutstanding),
      primarySalesperson: primary ? { id: primary.salesperson.id, name: primary.salesperson.user.name, assignedAt: primary.assignedAt } : null,
      backupSalesperson: backup ? { id: backup.salesperson.id, name: backup.salesperson.user.name, assignedAt: backup.assignedAt } : null,
      assignedAt: primary?.assignedAt ?? null,
      distanceMeters: hasCoords ? calculateHaversineDistanceMeters(lat, lng, c.latitude, c.longitude) : undefined,
    };
  });
  if (hasCoords) data.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));

  return json({ total, data });
});

export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER], managerPermission: 'canManageClients' }, async (ctx) => {
  const client = await createClient(ctx.user, await readJson(ctx.req), actorFrom(ctx));
  return json({ data: client }, 201);
});
