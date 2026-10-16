import { Router, Request, Response } from 'express';
import { prisma, Role } from '../db';
import { authenticateToken } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

interface SyncItem {
  localId: string;
  type: 'START_DAY' | 'END_DAY' | 'VISIT_START' | 'VISIT_END' | 'ORDER' | 'PAYMENT' | 'GPS_BATCH' | 'EXPENSE';
  payload: any;
  idempotencyKey: string;
}

// POST /api/sync/batch (Section 28: Durable Sync Engine)
router.post('/batch', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { items }: { items: SyncItem[] } = req.body;
  const user = req.user!;

  if (!items || !Array.isArray(items)) {
    res.status(400).json({ error: 'items array is required' });
    return;
  }

  const results: Array<{ localId: string; serverId?: string; status: 'SYNCED' | 'FAILED'; error?: string }> = [];

  for (const item of items) {
    try {
      // 1. Check idempotency
      if (item.idempotencyKey) {
        const existingKey = await prisma.idempotencyKey.findUnique({
          where: { key: item.idempotencyKey },
        });

        if (existingKey) {
          const body = existingKey.responseBody as any;
          results.push({
            localId: item.localId,
            serverId: body?.data?.id || body?.id,
            status: 'SYNCED',
          });
          continue;
        }
      }

      // 2. Process based on action type
      let serverId: string | undefined;

      if (item.type === 'START_DAY') {
        const { latitude, longitude, deviceId } = item.payload;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let attendance = await prisma.attendance.findFirst({
          where: { salespersonId: user.salespersonId!, status: 'ON_DUTY' },
        });

        if (!attendance) {
          attendance = await prisma.attendance.create({
            data: {
              salespersonId: user.salespersonId!,
              date: today,
              loginAt: new Date(item.payload.timestamp || Date.now()),
              loginLatitude: latitude,
              loginLongitude: longitude,
              status: 'ON_DUTY',
            },
          });

          await prisma.locationSession.create({
            data: {
              salespersonId: user.salespersonId!,
              attendanceId: attendance.id,
              startedAt: attendance.loginAt,
              status: 'ACTIVE',
            },
          });

          await prisma.salesperson.update({
            where: { id: user.salespersonId! },
            data: { status: 'ON_DUTY', deviceId },
          });
        }
        serverId = attendance.id;
      } else if (item.type === 'GPS_BATCH') {
        const { points, sessionId } = item.payload;
        if (Array.isArray(points) && points.length > 0) {
          const activeSession = sessionId
            ? { id: sessionId }
            : await prisma.locationSession.findFirst({
                where: { salespersonId: user.salespersonId!, status: 'ACTIVE' },
                orderBy: { startedAt: 'desc' },
              });

          if (activeSession) {
            await prisma.locationPoint.createMany({
              data: points.map((p: any) => ({
                sessionId: activeSession.id,
                salespersonId: user.salespersonId!,
                latitude: p.latitude,
                longitude: p.longitude,
                accuracy: p.accuracy || null,
                speed: p.speed || null,
                batteryLevel: p.batteryLevel || null,
                clientPointId: p.clientPointId || p.id || undefined,
                timestamp: new Date(p.timestamp || Date.now()),
              })),
              skipDuplicates: true,
            });
            serverId = activeSession.id;
          }
        }
      } else if (item.type === 'VISIT_START') {
        const { clientId, latitude, longitude, isException, exceptionReason } = item.payload;
        const visit = await prisma.clientVisit.create({
          data: {
            clientId,
            salespersonId: user.salespersonId!,
            startedAt: new Date(item.payload.startedAt || Date.now()),
            latitude,
            longitude,
            distanceFromClient: item.payload.distanceFromClient || 0,
            isException: Boolean(isException),
            exceptionReason: exceptionReason || null,
            outcome: 'FOLLOW_UP_REQUIRED',
          },
        });
        serverId = visit.id;
      } else if (item.type === 'VISIT_END') {
        const { visitId, outcome, notes, photoUrl } = item.payload;
        const visit = await prisma.clientVisit.update({
          where: { id: visitId },
          data: {
            endedAt: new Date(item.payload.endedAt || Date.now()),
            outcome,
            notes,
            photoUrl,
          },
        });
        serverId = visit.id;
      } else if (item.type === 'ORDER') {
        const { clientId, items: orderItems, discount, notes } = item.payload;
        const year = new Date().getFullYear();
        const count = await prisma.order.count();
        const orderNumber = `ORD-${year}-${String(count + 1).padStart(6, '0')}`;

        const client = await prisma.client.findUnique({ where: { id: clientId } });
        let subtotal = 0;
        let tax = 0;

        const preparedItems = [];
        for (const it of orderItems) {
          const product = await prisma.product.findUnique({ where: { id: it.productId } });
          if (product) {
            const price = it.unitPrice || Number(product.sellingPrice);
            const lineSubtotal = it.quantity * price;
            const lineTax = (lineSubtotal * Number(product.taxRate)) / 100;
            subtotal += lineSubtotal;
            tax += lineTax;
            preparedItems.push({
              productId: product.id,
              productName: product.name,
              productSku: product.sku,
              quantity: it.quantity,
              unitPrice: price,
              discount: 0,
              tax: lineTax,
              total: lineSubtotal + lineTax,
            });
          }
        }

        const grandTotal = subtotal - (discount || 0) + tax;

        const order = await prisma.order.create({
          data: {
            orderNumber,
            clientId,
            salespersonId: user.salespersonId!,
            status: 'CONFIRMED',
            subtotal,
            discount: discount || 0,
            tax,
            grandTotal,
            notes,
            items: { create: preparedItems },
          },
        });

        // Update client balance & ledger
        if (client) {
          const newBal = Number(client.currentOutstanding) + grandTotal;
          await prisma.client.update({
            where: { id: client.id },
            data: { currentOutstanding: newBal },
          });
          await prisma.clientLedgerEntry.create({
            data: {
              clientId: client.id,
              orderId: order.id,
              entryType: 'INVOICE',
              amount: grandTotal,
              runningBalance: newBal,
              description: `Invoice for offline-synced Order #${order.orderNumber}`,
            },
          });
        }
        serverId = order.id;
      } else if (item.type === 'PAYMENT') {
        const { clientId, amount, paymentMethod, transactionReference, notes, orderId } = item.payload;
        const year = new Date().getFullYear();
        const count = await prisma.payment.count();
        const receiptNumber = `PAY-${year}-${String(count + 1).padStart(5, '0')}`;

        const payment = await prisma.payment.create({
          data: {
            receiptNumber,
            clientId,
            salespersonId: user.salespersonId!,
            orderId,
            amount,
            paymentMethod,
            transactionReference,
            status: 'PENDING',
            notes,
            collectedAt: new Date(item.payload.collectedAt || Date.now()),
          },
        });
        serverId = payment.id;
      } else if (item.type === 'EXPENSE') {
        const {
          category,
          amount,
          expenseDate,
          description,
          businessPurpose,
          merchantName,
          paymentMethod,
          receiptUrl,
          clientId,
          visitId,
          attendanceId,
          latitude,
          longitude,
          status,
          offlineId,
        } = item.payload;

        const currentYear = new Date().getFullYear();
        const prefix = `EXP-${currentYear}-`;
        const count = await prisma.expense.count();
        const expenseNumber = `${prefix}${String(count + 1).padStart(6, '0')}`;
        const isSubmitted = status === 'SUBMITTED';

        const expense = await prisma.expense.create({
          data: {
            expenseNumber,
            salespersonId: user.salespersonId!,
            category,
            amount,
            expenseDate: new Date(expenseDate || Date.now()),
            description,
            businessPurpose,
            merchantName,
            paymentMethod: paymentMethod || 'CASH',
            receiptUrl,
            clientId,
            visitId,
            attendanceId,
            latitude,
            longitude,
            status: isSubmitted ? 'SUBMITTED' : 'DRAFT',
            submittedAt: isSubmitted ? new Date() : null,
            offlineId: offlineId || item.localId,
          },
        });

        await prisma.expenseHistory.create({
          data: {
            expenseId: expense.id,
            actorId: user.id,
            action: isSubmitted ? 'SUBMITTED_OFFLINE' : 'DRAFT_OFFLINE',
            newStatus: expense.status,
            comment: 'Offline-synchronized expense claim',
          },
        });

        serverId = expense.id;
      }

      // Record idempotency
      if (item.idempotencyKey) {
        await prisma.idempotencyKey.create({
          data: {
            key: item.idempotencyKey,
            endpoint: '/api/sync/batch',
            salespersonId: user.salespersonId,
            responseCode: 200,
            responseBody: { serverId },
          },
        });
      }

      results.push({
        localId: item.localId,
        serverId,
        status: 'SYNCED',
      });
    } catch (err: any) {
      console.error(`Sync error for item ${item.localId}:`, err);
      results.push({
        localId: item.localId,
        status: 'FAILED',
        error: err.message || 'Sync failed',
      });
    }
  }

  res.json({ results });
});

export default router;
