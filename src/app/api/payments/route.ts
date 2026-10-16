import { prisma, PaymentStatus, type Prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { pagination, readJson, searchParams } from '@/lib/http/request';
import { scopedSalespersonFilter } from '@/lib/permissions';
import { parseDateRange } from '@/lib/time';
import { actorFrom } from '@/lib/services/audit';
import { createPayment } from '@/features/payments/service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute({ managerPermission: 'canViewPayments' }, async ({ req, user }) => {
  const sp = searchParams(req);
  const { limit, offset } = pagination(sp, { limit: 50, max: 500 });
  const where: Prisma.PaymentWhereInput = {};
  const status = sp.get('status');
  if (status && (Object.values(PaymentStatus) as string[]).includes(status)) where.status = status as PaymentStatus;
  if (sp.get('clientId')) where.clientId = sp.get('clientId')!;
  const spFilter = scopedSalespersonFilter(user, sp.get('salespersonId'));
  if (spFilter !== undefined) where.salespersonId = spFilter;
  const range = parseDateRange(sp.get('from'), sp.get('to'));
  if (range) where.collectedAt = range;
  const search = sp.get('search');
  if (search) {
    where.OR = [
      { receiptNumber: { contains: search, mode: 'insensitive' } },
      { transactionReference: { contains: search, mode: 'insensitive' } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true } },
        salesperson: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
        verifiedBy: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
      orderBy: { collectedAt: 'desc' },
      skip: offset,
      take: limit,
    }),
  ]);

  return json({
    total,
    data: payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      clientId: p.clientId,
      clientName: p.client.name,
      salespersonId: p.salespersonId,
      salespersonName: p.salesperson.user.name,
      salespersonCode: p.salesperson.employeeCode,
      orderNumber: p.order?.orderNumber || null,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      transactionReference: p.transactionReference,
      proofUrl: p.proofUrl,
      status: p.status,
      collectedAt: p.collectedAt,
      verifiedAt: p.verifiedAt,
      verifiedByName: p.verifiedBy?.name || null,
      notes: p.notes,
    })),
  });
});

export const POST = authedRoute({}, async (ctx) => {
  const r = await createPayment(ctx.user, await readJson(ctx.req), actorFrom(ctx));
  return json(r.body, r.status);
});
