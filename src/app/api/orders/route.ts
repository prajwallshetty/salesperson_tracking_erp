import { prisma, OrderStatus, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { pagination, readJson, searchParams } from '@/lib/http/request';
import { scopedSalespersonFilter } from '@/lib/permissions';
import { parseDateRange } from '@/lib/time';
import { actorFrom } from '@/lib/services/audit';
import { createOrder } from '@/features/orders/service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({ managerPermission: 'canViewOrders' }, async ({ req, user }) => {
  const sp = searchParams(req);
  const { limit, offset } = pagination(sp, { limit: 50, max: 500 });
  const where: Prisma.OrderWhereInput = {};
  const status = sp.get('status');
  if (status && (Object.values(OrderStatus) as string[]).includes(status)) where.status = status as OrderStatus;
  if (sp.get('clientId')) where.clientId = sp.get('clientId')!;
  const spFilter = scopedSalespersonFilter(user, sp.get('salespersonId'));
  if (spFilter !== undefined) where.salespersonId = spFilter;
  const range = parseDateRange(sp.get('from'), sp.get('to'));
  if (range) where.createdAt = range;
  const search = sp.get('search');
  if (search) {
    where.OR = [{ orderNumber: { contains: search, mode: 'insensitive' } }, { client: { name: { contains: search, mode: 'insensitive' } } }];
  }

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true, city: true } },
        salesperson: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
  ]);

  return json({
    total,
    data: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      clientId: o.clientId,
      clientName: o.client.name,
      salespersonId: o.salespersonId,
      salespersonName: o.salesperson.user.name,
      salespersonCode: o.salesperson.employeeCode,
      status: o.status,
      subtotal: Number(o.subtotal),
      discount: Number(o.discount),
      tax: Number(o.tax),
      grandTotal: Number(o.grandTotal),
      itemsCount: o._count.items,
      createdAt: o.createdAt,
    })),
  });
});

export const POST = authedRoute({}, async (ctx) => {
  const r = await createOrder(ctx.user, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
