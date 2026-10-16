import { Router, Request, Response } from 'express';
import { prisma, SalespersonStatus } from '../db';
import { authenticateToken, getAuthorizedSalespersonIds } from '../middleware/auth';

const router = Router();

// GET /api/dashboard/summary
router.get('/summary', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const spFilter: any = {};
  if (authorizedSalespersonIds !== undefined) {
    spFilter.id = { in: authorizedSalespersonIds };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. KPI Cards
  const [
    totalSalespersons,
    activeSalespersons,
    totalClients,
    todayOrders,
    todayPayments,
    allClientsOutstanding,
  ] = await Promise.all([
    prisma.salesperson.count({ where: spFilter }),
    prisma.salesperson.count({ where: { ...spFilter, status: SalespersonStatus.ON_DUTY } }),
    prisma.client.count(),
    prisma.order.findMany({
      where: {
        ...(authorizedSalespersonIds !== undefined ? { salespersonId: { in: authorizedSalespersonIds } } : {}),
        createdAt: { gte: today },
      },
      select: { grandTotal: true },
    }),
    prisma.payment.findMany({
      where: {
        ...(authorizedSalespersonIds !== undefined ? { salespersonId: { in: authorizedSalespersonIds } } : {}),
        collectedAt: { gte: today },
      },
      select: { amount: true, status: true },
    }),
    prisma.client.aggregate({
      _sum: { currentOutstanding: true },
    }),
  ]);

  const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
  const todayVerifiedCollections = todayPayments
    .filter((p) => p.status === 'VERIFIED')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const todayPendingCollections = todayPayments
    .filter((p) => p.status === 'PENDING')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const totalOutstanding = Number(allClientsOutstanding._sum.currentOutstanding || 0);

  // 2. Charts Data (Last 7 days trend)
  const last7Days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(d.toISOString().split('T')[0]);
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const [recentOrders, recentPayments, topProductsData, topSalespersons] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...(authorizedSalespersonIds !== undefined ? { salespersonId: { in: authorizedSalespersonIds } } : {}),
        createdAt: { gte: sevenDaysAgo },
      },
      select: { grandTotal: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: {
        ...(authorizedSalespersonIds !== undefined ? { salespersonId: { in: authorizedSalespersonIds } } : {}),
        collectedAt: { gte: sevenDaysAgo },
        status: 'VERIFIED',
      },
      select: { amount: true, collectedAt: true },
    }),
    prisma.orderItem.groupBy({
      by: ['productId', 'productName'],
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    }),
    prisma.salesperson.findMany({
      where: spFilter,
      include: {
        user: { select: { name: true } },
        orders: {
          where: { createdAt: { gte: sevenDaysAgo } },
          select: { grandTotal: true },
        },
        payments: {
          where: { collectedAt: { gte: sevenDaysAgo }, status: 'VERIFIED' },
          select: { amount: true },
        },
      },
    }),
  ]);

  // Aggregate by day
  const salesByDayMap = new Map<string, number>();
  const collectionsByDayMap = new Map<string, number>();
  last7Days.forEach((d) => {
    salesByDayMap.set(d, 0);
    collectionsByDayMap.set(d, 0);
  });

  for (const o of recentOrders) {
    const dateStr = o.createdAt.toISOString().split('T')[0];
    if (salesByDayMap.has(dateStr)) {
      salesByDayMap.set(dateStr, salesByDayMap.get(dateStr)! + Number(o.grandTotal));
    }
  }

  for (const p of recentPayments) {
    const dateStr = p.collectedAt.toISOString().split('T')[0];
    if (collectionsByDayMap.has(dateStr)) {
      collectionsByDayMap.set(dateStr, collectionsByDayMap.get(dateStr)! + Number(p.amount));
    }
  }

  const chartSales = last7Days.map((date) => ({ date, amount: salesByDayMap.get(date) || 0 }));
  const chartCollections = last7Days.map((date) => ({ date, amount: collectionsByDayMap.get(date) || 0 }));

  const topProducts = topProductsData.map((tp) => ({
    name: tp.productName,
    quantity: tp._sum.quantity || 0,
    total: Number(tp._sum.total || 0),
  }));

  const salespersonPerformance = topSalespersons
    .map((s) => ({
      id: s.id,
      name: s.user.name,
      territory: s.territory,
      status: s.status,
      ordersCount: s.orders.length,
      sales: s.orders.reduce((sum, o) => sum + Number(o.grandTotal), 0),
      collections: s.payments.reduce((sum, p) => sum + Number(p.amount), 0),
    }))
    .sort((a, b) => b.sales - a.sales);

  res.json({
    kpis: {
      totalSalespersons,
      activeSalespersons,
      totalClients,
      todayOrdersCount: todayOrders.length,
      todaySales,
      todayVerifiedCollections,
      todayPendingCollections,
      todayTotalCollections: todayVerifiedCollections + todayPendingCollections,
      totalOutstanding,
    },
    charts: {
      salesByDay: chartSales,
      collectionsByDay: chartCollections,
      topProducts,
      salespersonPerformance,
    },
  });
});

export default router;
