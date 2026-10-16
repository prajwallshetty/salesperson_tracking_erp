import { Router, Request, Response } from 'express';
import { prisma, Role, OrderStatus, LedgerEntryType } from '../db';
import { createOrderSchema, updateOrderStatusSchema, calculateOrderTotals } from '../shared';
import { authenticateToken, getAuthorizedSalespersonIds, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';
import { notifyOrderCreated, notifyOrderStatusChanged } from '../socket';

const router = Router();

// Helper to generate sequential order number: ORD-YYYY-XXXXXX
async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  const sequence = String(count + 1).padStart(6, '0');
  return `ORD-${year}-${sequence}`;
}

// GET /api/orders
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { status, clientId, salespersonId, from, to, search, limit = 50, offset = 0 } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (status) whereClause.status = status as OrderStatus;
  if (clientId) whereClause.clientId = String(clientId);

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (from || to) {
    whereClause.createdAt = {};
    if (from) whereClause.createdAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.createdAt.lte = toDate;
    }
  }

  if (search) {
    const s = String(search).toLowerCase();
    whereClause.OR = [
      { orderNumber: { contains: s, mode: 'insensitive' } },
      { client: { name: { contains: s, mode: 'insensitive' } } },
    ];
  }

  const [total, orders] = await Promise.all([
    prisma.order.count({ where: whereClause }),
    prisma.order.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, phone: true, city: true } },
        salesperson: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: Number(offset),
      take: Number(limit),
    }),
  ]);

  res.json({
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
      itemsCount: o.items.length,
      createdAt: o.createdAt,
    })),
  });
});

// GET /api/orders/:id
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      client: true,
      salesperson: { include: { user: { select: { name: true, phone: true } } } },
      items: true,
      payments: true,
      approvedBy: { select: { name: true } },
    },
  });

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  if (authorizedSalespersonIds !== undefined && !authorizedSalespersonIds.includes(order.salespersonId)) {
    res.status(403).json({ error: 'Access denied to this order' });
    return;
  }

  res.json({ data: order });
});

// POST /api/orders (Create Order)
router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = createOrderSchema.parse(req.body);
  const user = req.user!;

  // Resolve salesperson ID (enforce authenticated salesperson)
  let salespersonId = user.salespersonId;
  if (!salespersonId) {
    if (user.role === Role.SUPER_ADMIN || user.role === Role.MANAGER) {
      salespersonId = req.body.salespersonId;
    }
    if (!salespersonId) {
      res.status(400).json({ error: 'Salesperson ID is required for order creation' });
      return;
    }
  }

  // Idempotency check
  if (parsed.idempotencyKey) {
    const existingKey = await prisma.idempotencyKey.findUnique({
      where: { key: parsed.idempotencyKey },
    });
    if (existingKey) {
      res.status(existingKey.responseCode).json(existingKey.responseBody);
      return;
    }
  }

  // Fetch products and verify stock
  const productIds = parsed.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Verify all products exist
  for (const item of parsed.items) {
    const p = productMap.get(item.productId);
    if (!p) {
      res.status(400).json({ error: `Product ID ${item.productId} not found` });
      return;
    }
  }

  // Check client exists
  const client = await prisma.client.findUnique({
    where: { id: parsed.clientId },
  });
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  // Calculate order items with snapshot pricing
  const calculationInputs = parsed.items.map((item) => {
    const p = productMap.get(item.productId)!;
    return {
      quantity: item.quantity,
      unitPrice: item.unitPrice !== undefined ? item.unitPrice : Number(p.sellingPrice),
      discount: item.discount !== undefined ? item.discount : Number(p.discount),
      taxRate: item.taxRate !== undefined ? item.taxRate : Number(p.taxRate),
    };
  });

  const calculated = calculateOrderTotals(calculationInputs, parsed.discount);

  // Check system setting for auto-confirmation vs manager approval
  const approvalSetting = await prisma.systemSetting.findUnique({
    where: { key: 'manager_order_approval_required' },
  });
  const initialStatus = approvalSetting?.value === 'true' ? OrderStatus.SUBMITTED : OrderStatus.CONFIRMED;

  const orderNumber = await generateOrderNumber();

  const newOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        clientId: parsed.clientId,
        salespersonId,
        status: initialStatus,
        subtotal: calculated.subtotal,
        discount: calculated.discount,
        tax: calculated.tax,
        grandTotal: calculated.grandTotal,
        notes: parsed.notes,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        items: {
          create: parsed.items.map((item, index) => {
            const p = productMap.get(item.productId)!;
            const calcItem = calculated.items[index];
            return {
              productId: p.id,
              productName: p.name,
              productSku: p.sku,
              quantity: item.quantity,
              unitPrice: calcItem.unitPrice,
              discount: calcItem.discount,
              tax: calcItem.taxAmount,
              total: calcItem.total,
            };
          }),
        },
      },
      include: { items: true },
    });

    // If order is CONFIRMED immediately, deduct stock & post invoice to ledger
    if (initialStatus === OrderStatus.CONFIRMED) {
      for (const item of parsed.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const newOutstanding = Number(client.currentOutstanding) + calculated.grandTotal;
      await tx.client.update({
        where: { id: client.id },
        data: { currentOutstanding: newOutstanding },
      });

      await tx.clientLedgerEntry.create({
        data: {
          clientId: client.id,
          orderId: order.id,
          entryType: LedgerEntryType.INVOICE,
          amount: calculated.grandTotal,
          runningBalance: newOutstanding,
          description: `Invoice posted for Order #${order.orderNumber}`,
        },
      });
    }

    return order;
  });

  // Admin Notification
  await prisma.notification.create({
    data: {
      role: Role.SUPER_ADMIN,
      title: 'New Order Created',
      message: `Order #${newOrder.orderNumber} for ₹${newOrder.grandTotal} created for ${client.name}.`,
      type: 'ORDER',
      metadata: { orderId: newOrder.id, grandTotal: newOrder.grandTotal },
    },
  });

  await logAuditEvent({
    req,
    action: 'CREATE_ORDER',
    module: 'ORDER',
    recordId: newOrder.id,
    newValue: { orderNumber: newOrder.orderNumber, grandTotal: newOrder.grandTotal, status: newOrder.status },
  });

  notifyOrderCreated(newOrder);

  const responsePayload = { data: newOrder };

  // Save idempotency key if provided
  if (parsed.idempotencyKey) {
    await prisma.idempotencyKey.create({
      data: {
        key: parsed.idempotencyKey,
        endpoint: '/api/orders',
        salespersonId,
        responseCode: 201,
        responseBody: responsePayload,
      },
    });
  }

  res.status(201).json(responsePayload);
});

// PUT /api/orders/:id/status (Approval workflow & status progression)
router.put('/:id/status', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const parsed = updateOrderStatusSchema.parse(req.body);
  const user = req.user!;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, client: true },
  });

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const prevStatus = order.status;
  const nextStatus = parsed.status;

  if (prevStatus === nextStatus) {
    res.json({ data: order });
    return;
  }

  // Handle stock deduction / restoration & ledger postings
  await prisma.$transaction(async (tx) => {
    // If moving to CONFIRMED and wasn't previously confirmed
    if (nextStatus === OrderStatus.CONFIRMED && prevStatus !== OrderStatus.CONFIRMED) {
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const newBalance = Number(order.client.currentOutstanding) + Number(order.grandTotal);
      await tx.client.update({
        where: { id: order.clientId },
        data: { currentOutstanding: newBalance },
      });

      await tx.clientLedgerEntry.create({
        data: {
          clientId: order.clientId,
          orderId: order.id,
          entryType: LedgerEntryType.INVOICE,
          amount: order.grandTotal,
          runningBalance: newBalance,
          description: `Invoice posted upon Order Confirmation #${order.orderNumber}`,
        },
      });
    }

    // If cancelling/rejecting an already CONFIRMED order, restore stock and reverse ledger debit
    if ((nextStatus === OrderStatus.CANCELLED || nextStatus === OrderStatus.REJECTED) && prevStatus === OrderStatus.CONFIRMED) {
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      const newBalance = Math.max(0, Number(order.client.currentOutstanding) - Number(order.grandTotal));
      await tx.client.update({
        where: { id: order.clientId },
        data: { currentOutstanding: newBalance },
      });

      await tx.clientLedgerEntry.create({
        data: {
          clientId: order.clientId,
          orderId: order.id,
          entryType: LedgerEntryType.REVERSAL,
          amount: order.grandTotal,
          runningBalance: newBalance,
          description: `Reversal of Invoice for cancelled/rejected Order #${order.orderNumber}`,
        },
      });
    }

    // Update order record
    await tx.order.update({
      where: { id },
      data: {
        status: nextStatus,
        approvedById: nextStatus === OrderStatus.CONFIRMED ? user.id : undefined,
        approvedAt: nextStatus === OrderStatus.CONFIRMED ? new Date() : undefined,
        rejectedReason: parsed.rejectedReason,
        notes: parsed.notes ? `${order.notes || ''}\n${parsed.notes}`.trim() : order.notes,
      },
    });
  });

  await logAuditEvent({
    req,
    action: 'UPDATE_ORDER_STATUS',
    module: 'ORDER',
    recordId: id,
    oldValue: { status: prevStatus },
    newValue: { status: nextStatus, rejectedReason: parsed.rejectedReason },
  });

  notifyOrderStatusChanged({
    id,
    orderNumber: order.orderNumber,
    salespersonId: order.salespersonId,
    status: nextStatus,
    previousStatus: prevStatus,
  });

  res.json({ message: `Order status updated to ${nextStatus}` });
});

export default router;
