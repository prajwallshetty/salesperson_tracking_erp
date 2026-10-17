import { z } from 'zod';
import { prisma, LedgerEntryType, OrderStatus, Prisma, Role, TxClient, currentTenantId } from '@/lib/db';
import { calculateOrderTotals } from '@/lib/domain/orderCalculator';
import { createOrderSchema, updateOrderStatusSchema } from '@/lib/validations/schemas';
import { badRequest, forbidden, notFound } from '@/lib/http/errors';
import { getAccessibleClient, assertSalespersonAccess, resolveActingSalespersonId } from '@/lib/services/access';
import { postLedgerEntry } from '@/lib/services/ledger';
import { nextDocumentNumber, withUniqueRetry, isUniqueViolation } from '@/lib/services/numbering';
import { findIdempotentResponse, storeIdempotentResponse, type StoredResponse } from '@/lib/services/idempotency';
import { isOrderApprovalRequired } from '@/lib/services/settings';
import { createNotification } from '@/lib/services/notifications';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import { notifyOrderCreated, notifyOrderStatusChanged } from '@/lib/realtime/emitter';
import type { AuthenticatedUser } from '@/lib/permissions';

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/**
 * Statuses in which the order's invoice is posted to the client ledger and its stock deducted.
 * Legacy only treated CONFIRMED as invoiced, so cancelling a PROCESSING/DISPATCHED/DELIVERED
 * order never reversed it and PROCESSING → CONFIRMED double-posted the invoice.
 */
export const INVOICED_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
];
export const isInvoiced = (s: OrderStatus) => INVOICED_STATUSES.includes(s);

export async function createOrder(
  user: AuthenticatedUser,
  rawInput: unknown,
  actor: AuditActor,
  opts: { endpoint?: string } = {}
): Promise<StoredResponse> {
  const input = createOrderSchema.parse(rawInput);
  const salespersonId = await resolveActingSalespersonId(
    user,
    (rawInput as Record<string, unknown>)?.salespersonId,
    'Salesperson ID is required for order creation'
  );

  const replay = await findIdempotentResponse(input.idempotencyKey);
  if (replay) return replay;

  const products = await prisma.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const item of input.items) {
    if (!productMap.has(item.productId)) throw badRequest(`Product ID ${item.productId} not found`);
  }

  const client = await getAccessibleClient(user, input.clientId);

  // Snapshot pricing: request overrides, else catalogue values (legacy rule).
  const calculated = calculateOrderTotals(
    input.items.map((item) => {
      const p = productMap.get(item.productId)!;
      return {
        quantity: item.quantity,
        unitPrice: item.unitPrice !== undefined ? item.unitPrice : Number(p.sellingPrice),
        discount: item.discount !== undefined ? item.discount : Number(p.discount),
        taxRate: item.taxRate !== undefined ? item.taxRate : Number(p.taxRate),
      };
    }),
    input.discount
  );

  const initialStatus = (await isOrderApprovalRequired()) ? OrderStatus.SUBMITTED : OrderStatus.CONFIRMED;
  const endpoint = opts.endpoint ?? '/api/orders';

  let order;
  try {
    order = await withUniqueRetry(() =>
      prisma.$transaction(async (tx) => {
        const orderNumber = await nextDocumentNumber(tx, 'order');
        const created = await tx.order.create({
          data: {
            orderNumber,
            clientId: input.clientId,
            salespersonId,
            status: initialStatus,
            subtotal: calculated.subtotal,
            discount: calculated.discount,
            tax: calculated.tax,
            grandTotal: calculated.grandTotal,
            notes: input.notes,
            latitude: input.latitude,
            longitude: input.longitude,
            items: {
              create: input.items.map((item, index) => {
                const p = productMap.get(item.productId)!;
                const line = calculated.items[index];
                return {
                  productId: p.id,
                  productName: p.name,
                  productSku: p.sku,
                  quantity: item.quantity,
                  unitPrice: line.unitPrice,
                  discount: line.discount,
                  tax: line.taxAmount,
                  total: line.total,
                };
              }),
            },
          },
          include: { items: true },
        });

        if (initialStatus === OrderStatus.CONFIRMED) {
          await applyInvoice(tx, created, `Invoice posted for Order #${created.orderNumber}`);
        }
        await storeIdempotentResponse(tx, input.idempotencyKey, {
          endpoint,
          salespersonId,
          status: 201,
          body: { data: created },
        });
        return created;
      })
    );
  } catch (err) {
    // A concurrent duplicate committed first: replay its response instead of failing.
    if (isUniqueViolation(err)) {
      const replayAfter = await findIdempotentResponse(input.idempotencyKey);
      if (replayAfter) return replayAfter;
    }
    throw err;
  }

  await createNotification({
    role: Role.SUPER_ADMIN,
    title: 'New Order Created',
    message: `Order #${order.orderNumber} for ₹${order.grandTotal} created for ${client.name}.`,
    type: 'ORDER',
    metadata: { orderId: order.id, grandTotal: Number(order.grandTotal) },
  });
  await logAuditEvent({
    actor,
    action: 'CREATE_ORDER',
    module: 'ORDER',
    recordId: order.id,
    newValue: { orderNumber: order.orderNumber, grandTotal: order.grandTotal, status: order.status },
  });
  notifyOrderCreated({ ...order, clientName: client.name });

  return { status: 201, body: { data: JSON.parse(JSON.stringify(order)) } };
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

async function applyInvoice(tx: TxClient, order: OrderWithItems, description: string) {
  for (const item of order.items) {
    await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
  }
  await postLedgerEntry(tx, {
    clientId: order.clientId,
    orderId: order.id,
    entryType: LedgerEntryType.INVOICE,
    amount: Number(order.grandTotal),
    description,
  });
}

async function reverseInvoice(tx: TxClient, order: OrderWithItems) {
  for (const item of order.items) {
    await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  }
  await postLedgerEntry(tx, {
    clientId: order.clientId,
    orderId: order.id,
    entryType: LedgerEntryType.REVERSAL,
    amount: Number(order.grandTotal),
    description: `Reversal of Invoice for cancelled/rejected Order #${order.orderNumber}`,
  });
}

export async function updateOrderStatus(
  user: AuthenticatedUser,
  orderId: string,
  rawInput: unknown,
  actor: AuditActor
): Promise<StoredResponse> {
  const input = updateOrderStatusSchema.parse(rawInput);

  const result = await prisma.$transaction(async (tx) => {
    // Row lock serialises concurrent approvals of the same order.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "orders" WHERE "id" = ${orderId} AND "tenantId" = ${currentTenantId()} FOR UPDATE`;
    if (!locked.length) throw notFound('Order not found');

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    assertSalespersonAccess(user, order.salespersonId, 'You can only manage orders for salespersons in your team');

    const prevStatus = order.status;
    const nextStatus = input.status as OrderStatus;
    if (prevStatus === nextStatus) return { changed: false as const, order };

    const wasInvoiced = isInvoiced(prevStatus);
    const willBeInvoiced = isInvoiced(nextStatus);
    if (!wasInvoiced && willBeInvoiced) {
      await applyInvoice(tx, order, `Invoice posted upon Order Confirmation #${order.orderNumber}`);
    } else if (wasInvoiced && !willBeInvoiced) {
      await reverseInvoice(tx, order);
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        approvedById: nextStatus === OrderStatus.CONFIRMED ? user.id : undefined,
        approvedAt: nextStatus === OrderStatus.CONFIRMED ? new Date() : undefined,
        rejectedReason: input.rejectedReason,
        notes: input.notes ? `${order.notes || ''}\n${input.notes}`.trim() : order.notes,
      },
    });
    return { changed: true as const, order, prevStatus, nextStatus };
  });

  if (!result.changed) return { status: 200, body: { data: JSON.parse(JSON.stringify(result.order)) } };

  const { order, prevStatus, nextStatus } = result;
  await logAuditEvent({
    actor,
    action: 'UPDATE_ORDER_STATUS',
    module: 'ORDER',
    recordId: orderId,
    oldValue: { status: prevStatus },
    newValue: { status: nextStatus, rejectedReason: input.rejectedReason },
  });

  const sp = await prisma.salesperson.findUnique({ where: { id: order.salespersonId }, select: { userId: true } });
  if (sp) {
    await createNotification({
      recipientId: sp.userId,
      role: Role.SALESPERSON,
      title: 'Order Status Updated',
      message: `Order #${order.orderNumber} is now ${nextStatus}${input.rejectedReason ? `: ${input.rejectedReason}` : ''}.`,
      type: 'ORDER_UPDATE',
      metadata: { orderId },
    });
  }
  notifyOrderStatusChanged({ id: orderId, orderNumber: order.orderNumber, salespersonId: order.salespersonId, status: nextStatus, previousStatus: prevStatus });

  return { status: 200, body: { message: `Order status updated to ${nextStatus}` } };
}

export function assertOrderAccess(user: AuthenticatedUser, order: { salespersonId: string }) {
  try {
    assertSalespersonAccess(user, order.salespersonId);
  } catch {
    throw forbidden('Access denied to this order');
  }
}
