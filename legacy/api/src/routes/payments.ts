import { Router, Request, Response } from 'express';
import { prisma, Role, PaymentStatus, LedgerEntryType } from '../db';
import { createPaymentSchema, verifyPaymentSchema } from '../shared';
import { authenticateToken, getAuthorizedSalespersonIds, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';
import { generatePaymentReceiptPDF } from '../utils/pdfReceipt';
import { notifyPaymentCollected, notifyPaymentVerified } from '../socket';

const router = Router();

// Helper to generate sequential receipt number: PAY-YYYY-XXXXX
async function generateReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.payment.count();
  const sequence = String(count + 1).padStart(5, '0');
  return `PAY-${year}-${sequence}`;
}

// GET /api/payments
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { status, clientId, salespersonId, from, to, search, limit = 50, offset = 0 } = req.query;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const whereClause: any = {};

  if (status) whereClause.status = status as PaymentStatus;
  if (clientId) whereClause.clientId = String(clientId);

  if (salespersonId) {
    whereClause.salespersonId = String(salespersonId);
  } else if (authorizedSalespersonIds !== undefined) {
    whereClause.salespersonId = { in: authorizedSalespersonIds };
  }

  if (from || to) {
    whereClause.collectedAt = {};
    if (from) whereClause.collectedAt.gte = new Date(from as string);
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      whereClause.collectedAt.lte = toDate;
    }
  }

  if (search) {
    const s = String(search).toLowerCase();
    whereClause.OR = [
      { receiptNumber: { contains: s, mode: 'insensitive' } },
      { transactionReference: { contains: s, mode: 'insensitive' } },
      { client: { name: { contains: s, mode: 'insensitive' } } },
    ];
  }

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where: whereClause }),
    prisma.payment.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, phone: true } },
        salesperson: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
        verifiedBy: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
      orderBy: { collectedAt: 'desc' },
      skip: Number(offset),
      take: Number(limit),
    }),
  ]);

  res.json({
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

// GET /api/payments/:id
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = req.user!;
  const authorizedSalespersonIds = getAuthorizedSalespersonIds(user);

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      client: true,
      salesperson: { include: { user: { select: { name: true, phone: true } } } },
      verifiedBy: { select: { name: true } },
      order: true,
    },
  });

  if (!payment) {
    res.status(404).json({ error: 'Payment record not found' });
    return;
  }

  if (authorizedSalespersonIds !== undefined && !authorizedSalespersonIds.includes(payment.salespersonId)) {
    res.status(403).json({ error: 'Access denied to this payment' });
    return;
  }

  res.json({ data: payment });
});

// GET /api/payments/:id/receipt-pdf
router.get('/:id/receipt-pdf', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      client: true,
      salesperson: { include: { user: true } },
      verifiedBy: true,
    },
  });

  if (!payment) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }

  generatePaymentReceiptPDF(
    {
      receiptNumber: payment.receiptNumber,
      clientName: payment.client.name,
      clientAddress: payment.client.address,
      amount: Number(payment.amount),
      paymentMethod: payment.paymentMethod,
      transactionReference: payment.transactionReference,
      status: payment.status,
      collectedBy: payment.salesperson.user.name,
      collectedAt: payment.collectedAt,
      verifiedBy: payment.verifiedBy?.name,
      notes: payment.notes,
    },
    res
  );
});

// POST /api/payments (Collect Payment)
router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const parsed = createPaymentSchema.parse(req.body);
  const user = req.user!;

  let salespersonId = user.salespersonId;
  if (!salespersonId) {
    if (user.role === Role.SUPER_ADMIN || user.role === Role.MANAGER) {
      salespersonId = req.body.salespersonId;
    }
    if (!salespersonId) {
      res.status(400).json({ error: 'Salesperson ID is required for payment collection' });
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

  const client = await prisma.client.findUnique({
    where: { id: parsed.clientId },
  });
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  const receiptNumber = await generateReceiptNumber();

  // Cash verification setting check
  const cashVerificationSetting = await prisma.systemSetting.findUnique({
    where: { key: 'cash_verification_required' },
  });

  // Default status: PENDING unless policy explicitly allows direct verification
  let initialStatus: PaymentStatus = PaymentStatus.PENDING;
  if (parsed.paymentMethod === 'CASH' && cashVerificationSetting?.value === 'false') {
    initialStatus = PaymentStatus.VERIFIED;
  }

  const newPayment = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        receiptNumber,
        clientId: parsed.clientId,
        salespersonId,
        orderId: parsed.orderId,
        amount: parsed.amount,
        paymentMethod: parsed.paymentMethod,
        transactionReference: parsed.transactionReference,
        proofUrl: parsed.proofUrl,
        status: initialStatus,
        notes: parsed.notes,
        collectedAt: parsed.collectedAt ? new Date(parsed.collectedAt) : new Date(),
        verifiedAt: initialStatus === PaymentStatus.VERIFIED ? new Date() : undefined,
      },
      include: {
        client: { select: { name: true } },
        salesperson: { select: { user: { select: { name: true } } } },
      },
    });

    // If verified immediately by policy, post to ledger
    if (initialStatus === PaymentStatus.VERIFIED) {
      const newOutstanding = Math.max(0, Number(client.currentOutstanding) - parsed.amount);
      await tx.client.update({
        where: { id: client.id },
        data: { currentOutstanding: newOutstanding },
      });

      await tx.clientLedgerEntry.create({
        data: {
          clientId: client.id,
          paymentId: payment.id,
          entryType: LedgerEntryType.PAYMENT,
          amount: parsed.amount,
          runningBalance: newOutstanding,
          description: `Direct payment verified via ${parsed.paymentMethod} (${payment.receiptNumber})`,
        },
      });
    }

    return payment;
  });

  // Notify Admin/Manager for verification
  if (initialStatus === PaymentStatus.PENDING) {
    await prisma.notification.create({
      data: {
        role: Role.SUPER_ADMIN,
        title: 'Payment Verification Required',
        message: `New collection ${newPayment.receiptNumber} of ₹${newPayment.amount} from ${client.name} requires verification.`,
        type: 'PAYMENT_PENDING',
        metadata: { paymentId: newPayment.id, amount: newPayment.amount },
      },
    });
  }

  await logAuditEvent({
    req,
    action: 'CREATE_PAYMENT',
    module: 'PAYMENT',
    recordId: newPayment.id,
    newValue: { receiptNumber: newPayment.receiptNumber, amount: newPayment.amount, status: newPayment.status },
  });

  notifyPaymentCollected(newPayment);

  const responsePayload = { data: newPayment };

  if (parsed.idempotencyKey) {
    await prisma.idempotencyKey.create({
      data: {
        key: parsed.idempotencyKey,
        endpoint: '/api/payments',
        salespersonId,
        responseCode: 201,
        responseBody: responsePayload,
      },
    });
  }

  res.status(201).json(responsePayload);
});

// POST /api/payments/:id/verify (Verify / Reject payment)
router.post('/:id/verify', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const parsed = verifyPaymentSchema.parse(req.body);
  const user = req.user!;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { client: true, salesperson: { select: { userId: true } } },
  });

  if (!payment) {
    res.status(404).json({ error: 'Payment not found' });
    return;
  }

  if (payment.status === PaymentStatus.VERIFIED && parsed.status === 'VERIFIED') {
    res.status(400).json({ error: 'Payment is already verified' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (parsed.status === 'VERIFIED' && payment.status !== PaymentStatus.VERIFIED) {
      // Reduce client outstanding and post credit to ledger
      const newBalance = Math.max(0, Number(payment.client.currentOutstanding) - Number(payment.amount));
      await tx.client.update({
        where: { id: payment.clientId },
        data: { currentOutstanding: newBalance },
      });

      await tx.clientLedgerEntry.create({
        data: {
          clientId: payment.clientId,
          paymentId: payment.id,
          entryType: LedgerEntryType.PAYMENT,
          amount: payment.amount,
          runningBalance: newBalance,
          description: `Payment Verified: Receipt #${payment.receiptNumber} (${payment.paymentMethod})`,
        },
      });
    }

    await tx.payment.update({
      where: { id },
      data: {
        status: parsed.status as PaymentStatus,
        verifiedAt: parsed.status === 'VERIFIED' ? new Date() : undefined,
        verifiedById: user.id,
        notes: parsed.notes ? `${payment.notes || ''}\nVerification: ${parsed.notes}`.trim() : payment.notes,
      },
    });
  });

  // Notify salesperson of verification
  await prisma.notification.create({
    data: {
      recipientId: payment.salesperson.userId,
      role: Role.SALESPERSON,
      title: parsed.status === 'VERIFIED' ? 'Payment Verified' : 'Payment Collection Rejected',
      message: `Payment collection ${payment.receiptNumber} for ₹${payment.amount} has been ${parsed.status.toLowerCase()}.`,
      type: 'PAYMENT_UPDATE',
    },
  });

  await logAuditEvent({
    req,
    action: 'VERIFY_PAYMENT',
    module: 'PAYMENT',
    recordId: id,
    oldValue: { status: payment.status },
    newValue: { status: parsed.status, verifiedBy: user.name },
  });

  notifyPaymentVerified({
    id,
    receiptNumber: payment.receiptNumber,
    salespersonId: payment.salespersonId,
    status: parsed.status,
    amount: payment.amount,
  });

  res.json({ message: `Payment successfully marked as ${parsed.status}` });
});

export default router;
