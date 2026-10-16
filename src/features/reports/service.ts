import { prisma, type Prisma } from '@/lib/db';
import { scopedSalespersonFilter, type AuthenticatedUser } from '@/lib/permissions';
import { DEFAULT_TIMEZONE, businessDateString, parseDateOnlyRange, parseDateRange } from '@/lib/time';

export const REPORT_TYPES = ['sales', 'collections', 'attendance', 'visits', 'product-sales'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

type Cell = string | number | boolean | null | undefined;
interface Report {
  filePrefix: string;
  json: unknown;
  csv: { headers: string[]; rows: Cell[][] };
}

const time = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: DEFAULT_TIMEZONE });
const day = (d: Date) => businessDateString(d);
/** Exports are bounded; very large ranges should be narrowed by date. */
const MAX_ROWS = 20000;

export async function buildReport(type: ReportType, user: AuthenticatedUser, sp: URLSearchParams): Promise<Report> {
  const spFilter = scopedSalespersonFilter(user, sp.get('salespersonId'));
  const clientId = sp.get('clientId') || undefined;
  const range = parseDateRange(sp.get('from'), sp.get('to'));

  switch (type) {
    case 'sales': {
      const where: Prisma.OrderWhereInput = { salespersonId: spFilter, clientId, createdAt: range };
      const orders = await prisma.order.findMany({
        where,
        include: {
          client: { select: { name: true, city: true } },
          salesperson: { select: { employeeCode: true, user: { select: { name: true } } } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      });
      return {
        filePrefix: 'sales_report',
        json: {
          summary: { totalSales: orders.reduce((s, o) => s + Number(o.grandTotal), 0), totalOrders: orders.length },
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
            itemsCount: o._count.items,
          })),
        },
        csv: {
          headers: ['Order Number', 'Date', 'Salesperson', 'Client', 'City', 'Subtotal', 'Discount', 'Tax', 'Grand Total', 'Status'],
          rows: orders.map((o) => [o.orderNumber, day(o.createdAt), o.salesperson.user.name, o.client.name, o.client.city, Number(o.subtotal), Number(o.discount), Number(o.tax), Number(o.grandTotal), o.status]),
        },
      };
    }
    case 'collections': {
      const status = sp.get('status');
      const where: Prisma.PaymentWhereInput = { salespersonId: spFilter, clientId, collectedAt: range };
      if (status && ['PENDING', 'VERIFIED', 'REJECTED'].includes(status)) where.status = status as any;
      const payments = await prisma.payment.findMany({
        where,
        include: {
          client: { select: { name: true } },
          salesperson: { select: { employeeCode: true, user: { select: { name: true } } } },
          order: { select: { orderNumber: true } },
          verifiedBy: { select: { name: true } },
        },
        orderBy: { collectedAt: 'desc' },
        take: MAX_ROWS,
      });
      const sum = (s: string) => payments.filter((p) => p.status === s).reduce((t, p) => t + Number(p.amount), 0);
      const verifiedTotal = sum('VERIFIED');
      const pendingTotal = sum('PENDING');
      return {
        filePrefix: 'collections_report',
        json: {
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
        },
        csv: {
          headers: ['Receipt Number', 'Date', 'Salesperson', 'Client', 'Order Number', 'Amount', 'Payment Mode', 'Status', 'Verified By'],
          rows: payments.map((p) => [p.receiptNumber, day(p.collectedAt), p.salesperson.user.name, p.client.name, p.order?.orderNumber || 'N/A', Number(p.amount), p.paymentMethod, p.status, p.verifiedBy?.name || 'Unverified']),
        },
      };
    }
    case 'attendance': {
      const where: Prisma.AttendanceWhereInput = { salespersonId: spFilter, date: parseDateOnlyRange(sp.get('from'), sp.get('to')) };
      const rows = await prisma.attendance.findMany({
        where,
        include: { salesperson: { select: { employeeCode: true, territory: true, user: { select: { name: true } } } } },
        orderBy: { date: 'desc' },
        take: MAX_ROWS,
      });
      return {
        filePrefix: 'attendance_report',
        json: {
          data: rows.map((a) => ({
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
        },
        csv: {
          headers: ['Salesperson', 'Code', 'Territory', 'Date', 'Login Time', 'Logout Time', 'Work Minutes', 'Distance (KM)', 'Status'],
          rows: rows.map((a) => [a.salesperson.user.name, a.salesperson.employeeCode, a.salesperson.territory, a.date.toISOString().split('T')[0], time(a.loginAt), a.logoutAt ? time(a.logoutAt) : 'In Progress', a.workingMinutes, a.distanceTravelled, a.status]),
        },
      };
    }
    case 'visits': {
      const outcome = sp.get('outcome');
      const where: Prisma.ClientVisitWhereInput = { salespersonId: spFilter, clientId, startedAt: range };
      if (outcome) where.outcome = outcome as any;
      const visits = await prisma.clientVisit.findMany({
        where,
        include: { client: { select: { name: true, city: true } }, salesperson: { select: { employeeCode: true, user: { select: { name: true } } } } },
        orderBy: { startedAt: 'desc' },
        take: MAX_ROWS,
      });
      return {
        filePrefix: 'visits_report',
        json: {
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
        },
        csv: {
          headers: ['Salesperson', 'Client', 'City', 'Visit Date', 'Start Time', 'End Time', 'Distance (m)', 'Exception?', 'Outcome', 'Notes'],
          rows: visits.map((v) => [v.salesperson.user.name, v.client.name, v.client.city, day(v.startedAt), time(v.startedAt), v.endedAt ? time(v.endedAt) : 'Ongoing', v.distanceFromClient || 0, v.isException ? 'YES' : 'NO', v.outcome, v.notes || '']),
        },
      };
    }
    case 'product-sales': {
      // Aggregated in the database; scoped to the caller's salespersons (legacy was unscoped).
      const orderWhere: Prisma.OrderWhereInput = { salespersonId: spFilter, createdAt: range };
      const grouped = await prisma.orderItem.groupBy({
        by: ['productId', 'productSku', 'productName'],
        where: { order: orderWhere },
        _sum: { quantity: true, total: true },
      });
      const products = await prisma.product.findMany({
        where: { id: { in: grouped.map((g) => g.productId) } },
        select: { id: true, category: { select: { name: true } } },
      });
      const cat = new Map(products.map((p) => [p.id, p.category.name]));
      const merged = new Map<string, { sku: string; name: string; category: string; quantity: number; revenue: number }>();
      for (const g of grouped) {
        const e = merged.get(g.productId) || { sku: g.productSku, name: g.productName, category: cat.get(g.productId) || '', quantity: 0, revenue: 0 };
        e.quantity += g._sum.quantity || 0;
        e.revenue += Number(g._sum.total || 0);
        merged.set(g.productId, e);
      }
      const result = Array.from(merged.values()).sort((a, b) => b.revenue - a.revenue);
      return {
        filePrefix: 'product_sales_report',
        json: { data: result },
        csv: {
          headers: ['Product SKU', 'Product Name', 'Category', 'Quantity Sold', 'Revenue (INR)'],
          rows: result.map((r) => [r.sku, r.name, r.category, r.quantity, r.revenue]),
        },
      };
    }
  }
}
