import { Router, Request, Response } from 'express';
import { prisma, Role } from '../db';
import { authenticateToken, getAuthorizedSalespersonIds, requireRole } from '../middleware/auth';
import { sendCsvResponse } from '../utils/csvExporter';

const router = Router();

// GET /api/reports/sales
router.get('/sales', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { from, to, salespersonId, clientId, categoryId, format } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (clientId) whereClause.clientId = String(clientId);

  if (from || to) {
    whereClause.createdAt = {};
    if (from) whereClause.createdAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.createdAt.lte = toDate;
    }
  }

  const orders = await prisma.order.findMany({
    where: whereClause,
    include: {
      client: { select: { name: true, city: true } },
      salesperson: { select: { employeeCode: true, user: { select: { name: true } } } },
      items: {
        include: { product: { include: { category: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (format === 'csv') {
    const headers = ['Order Number', 'Date', 'Salesperson', 'Client', 'City', 'Subtotal', 'Discount', 'Tax', 'Grand Total', 'Status'];
    const rows = orders.map((o) => [
      o.orderNumber,
      o.createdAt.toISOString().split('T')[0],
      o.salesperson.user.name,
      o.client.name,
      o.client.city,
      Number(o.subtotal),
      Number(o.discount),
      Number(o.tax),
      Number(o.grandTotal),
      o.status,
    ]);
    sendCsvResponse(res, `sales_report_${Date.now()}.csv`, headers, rows);
    return;
  }

  const totalSales = orders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
  const totalOrders = orders.length;

  res.json({
    summary: { totalSales, totalOrders },
    data: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      date: o.createdAt,
      salespersonName: o.salesperson.user.name,
      salespersonCode: o.salesperson.employeeCode,
      clientName: o.client.name,
      clientCity: o.client.city,
      subtotal: Number(o.subtotal),
      discount: Number(o.discount),
      tax: Number(o.tax),
      grandTotal: Number(o.grandTotal),
      status: o.status,
      itemsCount: o.items.length,
    })),
  });
});

// GET /api/reports/collections
router.get('/collections', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { from, to, salespersonId, clientId, status, format } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (clientId) whereClause.clientId = String(clientId);
  if (status) whereClause.status = status as any;

  if (from || to) {
    whereClause.collectedAt = {};
    if (from) whereClause.collectedAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.collectedAt.lte = toDate;
    }
  }

  const payments = await prisma.payment.findMany({
    where: whereClause,
    include: {
      client: { select: { name: true } },
      salesperson: { select: { employeeCode: true, user: { select: { name: true } } } },
      order: { select: { orderNumber: true } },
      verifiedBy: { select: { name: true } },
    },
    orderBy: { collectedAt: 'desc' },
  });

  if (format === 'csv') {
    const headers = ['Receipt Number', 'Date', 'Salesperson', 'Client', 'Order Number', 'Amount', 'Payment Mode', 'Status', 'Verified By'];
    const rows = payments.map((p) => [
      p.receiptNumber,
      p.collectedAt.toISOString().split('T')[0],
      p.salesperson.user.name,
      p.client.name,
      p.order?.orderNumber || 'N/A',
      Number(p.amount),
      p.paymentMethod,
      p.status,
      p.verifiedBy?.name || 'Unverified',
    ]);
    sendCsvResponse(res, `collections_report_${Date.now()}.csv`, headers, rows);
    return;
  }

  const verifiedTotal = payments
    .filter((p) => p.status === 'VERIFIED')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const pendingTotal = payments
    .filter((p) => p.status === 'PENDING')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  res.json({
    summary: { verifiedTotal, pendingTotal, totalCollections: verifiedTotal + pendingTotal },
    data: payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      date: p.collectedAt,
      salespersonName: p.salesperson.user.name,
      salespersonCode: p.salesperson.employeeCode,
      clientName: p.client.name,
      orderNumber: p.order?.orderNumber || null,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      status: p.status,
      verifiedBy: p.verifiedBy?.name || null,
      verifiedAt: p.verifiedAt,
    })),
  });
});

// GET /api/reports/attendance
router.get('/attendance', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { from, to, salespersonId, format } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (from || to) {
    whereClause.date = {};
    if (from) whereClause.date.gte = new Date(from as string);
    if (to) whereClause.date.lte = new Date(to as string);
  }

  const attendances = await prisma.attendance.findMany({
    where: whereClause,
    include: {
      salesperson: { select: { employeeCode: true, territory: true, user: { select: { name: true } } } },
    },
    orderBy: { date: 'desc' },
  });

  if (format === 'csv') {
    const headers = ['Salesperson', 'Code', 'Territory', 'Date', 'Login Time', 'Logout Time', 'Work Minutes', 'Distance (KM)', 'Status'];
    const rows = attendances.map((a) => [
      a.salesperson.user.name,
      a.salesperson.employeeCode,
      a.salesperson.territory,
      a.date.toISOString().split('T')[0],
      a.loginAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
      a.logoutAt ? a.logoutAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'In Progress',
      a.workingMinutes,
      a.distanceTravelled,
      a.status,
    ]);
    sendCsvResponse(res, `attendance_report_${Date.now()}.csv`, headers, rows);
    return;
  }

  res.json({
    data: attendances.map((a) => ({
      id: a.id,
      salespersonName: a.salesperson.user.name,
      salespersonCode: a.salesperson.employeeCode,
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

// GET /api/reports/visits
router.get('/visits', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { from, to, salespersonId, clientId, outcome, format } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (clientId) whereClause.clientId = String(clientId);
  if (outcome) whereClause.outcome = outcome as any;

  if (from || to) {
    whereClause.startedAt = {};
    if (from) whereClause.startedAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.startedAt.lte = toDate;
    }
  }

  const visits = await prisma.clientVisit.findMany({
    where: whereClause,
    include: {
      client: { select: { name: true, city: true } },
      salesperson: { select: { employeeCode: true, user: { select: { name: true } } } },
    },
    orderBy: { startedAt: 'desc' },
  });

  if (format === 'csv') {
    const headers = ['Salesperson', 'Client', 'City', 'Visit Date', 'Start Time', 'End Time', 'Distance (m)', 'Exception?', 'Outcome', 'Notes'];
    const rows = visits.map((v) => [
      v.salesperson.user.name,
      v.client.name,
      v.client.city,
      v.startedAt.toISOString().split('T')[0],
      v.startedAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
      v.endedAt ? v.endedAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Ongoing',
      v.distanceFromClient || 0,
      v.isException ? 'YES' : 'NO',
      v.outcome,
      v.notes || '',
    ]);
    sendCsvResponse(res, `visits_report_${Date.now()}.csv`, headers, rows);
    return;
  }

  res.json({
    summary: { totalVisits: visits.length },
    data: visits.map((v) => ({
      id: v.id,
      salespersonName: v.salesperson.user.name,
      salespersonCode: v.salesperson.employeeCode,
      clientName: v.client.name,
      clientCity: v.client.city,
      startedAt: v.startedAt,
      endedAt: v.endedAt,
      distanceFromClient: v.distanceFromClient,
      isException: v.isException,
      exceptionReason: v.exceptionReason,
      outcome: v.outcome,
      notes: v.notes,
    })),
  });
});

// GET /api/reports/product-sales (Section 18.5)
router.get('/product-sales', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { from, to, format } = req.query;

  const whereClause: any = {};
  if (from || to) {
    whereClause.order = { createdAt: {} };
    if (from) whereClause.order.createdAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.order.createdAt.lte = toDate;
    }
  }

  const items = await prisma.orderItem.findMany({
    where: whereClause,
    include: {
      product: { select: { sku: true, name: true, category: { select: { name: true } } } },
    },
  });

  const grouped = new Map<string, { sku: string; name: string; category: string; quantity: number; revenue: number }>();

  for (const item of items) {
    const existing = grouped.get(item.productId) || {
      sku: item.productSku,
      name: item.productName,
      category: item.product.category.name,
      quantity: 0,
      revenue: 0,
    };
    existing.quantity += item.quantity;
    existing.revenue += Number(item.total);
    grouped.set(item.productId, existing);
  }

  const result = Array.from(grouped.values()).sort((a, b) => b.revenue - a.revenue);

  if (format === 'csv') {
    const headers = ['Product SKU', 'Product Name', 'Category', 'Quantity Sold', 'Revenue (INR)'];
    const rows = result.map((r) => [r.sku, r.name, r.category, r.quantity, r.revenue]);
    sendCsvResponse(res, `product_sales_report_${Date.now()}.csv`, headers, rows);
    return;
  }

  res.json({ data: result });
});

export default router;
