import { prisma, LedgerEntryType, PaymentStatus, Role, currentTenantId } from '@/lib/db';
import { createPaymentSchema, verifyPaymentSchema } from '@/lib/validations/schemas';
import { badRequest, notFound } from '@/lib/http/errors';
import { assertSalespersonAccess, getAccessibleClient, resolveActingSalespersonId } from '@/lib/services/access';
import { postLedgerEntry } from '@/lib/services/ledger';
import { nextDocumentNumber, withUniqueRetry, isUniqueViolation } from '@/lib/services/numbering';
import { findIdempotentResponse, storeIdempotentResponse, type StoredResponse } from '@/lib/services/idempotency';
import { isCashVerificationRequired } from '@/lib/services/settings';
import { createNotification } from '@/lib/services/notifications';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import { notifyPaymentCollected, notifyPaymentVerified } from '@/lib/realtime/emitter';
import type { AuthenticatedUser } from '@/lib/permissions';

export async function createPayment(
  user: AuthenticatedUser,
  rawInput: unknown,
  actor: AuditActor,
  opts: { endpoint?: string } = {}
): Promise<StoredResponse> {
  const input = createPaymentSchema.parse(rawInput);
  const salespersonId = await resolveActingSalespersonId(
    user,
    (rawInput as Record<string, unknown>)?.salespersonId,
    'Salesperson ID is required for payment collection'
  );

  const replay = await findIdempotentResponse(input.idempotencyKey);
  if (replay) return replay;

  const client = await getAccessibleClient(user, input.clientId);
  if (input.orderId) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { clientId: true } });
    if (!order) throw notFound('Order not found');
    if (order.clientId !== input.clientId) throw badRequest('Order does not belong to the selected client');
  }

  // Default PENDING unless policy explicitly allows direct cash verification (legacy rule).
  const autoVerify = input.paymentMethod === 'CASH' && !(await isCashVerificationRequired());
  const initialStatus = autoVerify ? PaymentStatus.VERIFIED : PaymentStatus.PENDING;
  const endpoint = opts.endpoint ?? '/api/payments';

  let payment;
  try {
    payment = await withUniqueRetry(() =>
      prisma.$transaction(async (tx) => {
        const receiptNumber = await nextDocumentNumber(tx, 'payment');
        const created = await tx.payment.create({
          data: {
            receiptNumber,
            clientId: input.clientId,
            salespersonId,
            orderId: input.orderId,
            amount: input.amount,
            paymentMethod: input.paymentMethod,
            transactionReference: input.transactionReference,
            proofUrl: input.proofUrl,
            status: initialStatus,
            notes: input.notes,
            collectedAt: input.collectedAt ? new Date(input.collectedAt) : new Date(),
            verifiedAt: autoVerify ? new Date() : undefined,
          },
          include: {
            client: { select: { name: true } },
            salesperson: { select: { user: { select: { name: true } } } },
          },
        });
        if (autoVerify) {
          await postLedgerEntry(tx, {
            clientId: input.clientId,
            paymentId: created.id,
            entryType: LedgerEntryType.PAYMENT,
            amount: input.amount,
            description: `Direct payment verified via ${input.paymentMethod} (${created.receiptNumber})`,
          });
        }
        await storeIdempotentResponse(tx, input.idempotencyKey, { endpoint, salespersonId, status: 201, body: { data: created } });
        return created;
      })
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      const replayAfter = await findIdempotentResponse(input.idempotencyKey);
      if (replayAfter) return replayAfter;
    }
    throw err;
  }

  if (initialStatus === PaymentStatus.PENDING) {
    await createNotification({
      role: Role.SUPER_ADMIN,
      title: 'Payment Verification Required',
      message: `New collection ${payment.receiptNumber} of ₹${payment.amount} from ${client.name} requires verification.`,
      type: 'PAYMENT_PENDING',
      metadata: { paymentId: payment.id, amount: Number(payment.amount) },
    });
  }
  await logAuditEvent({
    actor,
    action: 'CREATE_PAYMENT',
    module: 'PAYMENT',
    recordId: payment.id,
    newValue: { receiptNumber: payment.receiptNumber, amount: payment.amount, status: payment.status },
  });
  notifyPaymentCollected(payment as any);

  return { status: 201, body: { data: JSON.parse(JSON.stringify(payment)) } };
}

export async function verifyPayment(user: AuthenticatedUser, paymentId: string, rawInput: unknown, actor: AuditActor): Promise<StoredResponse> {
  const input = verifyPaymentSchema.parse(rawInput);

  const payment = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "payments" WHERE "id" = ${paymentId} AND "tenantId" = ${currentTenantId()} FOR UPDATE`;
    if (!locked.length) throw notFound('Payment not found');
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { salesperson: { select: { userId: true } } } });
    assertSalespersonAccess(user, p.salespersonId, 'You can only verify collections for salespersons in your team');

    // Only PENDING collections are reviewable. Legacy allowed VERIFIED → REJECTED, which left the
    // ledger credit in place; the UI only ever offered these actions for PENDING rows.
    if (p.status !== PaymentStatus.PENDING) {
      throw badRequest(p.status === PaymentStatus.VERIFIED ? 'Payment is already verified' : `Payment is already ${p.status.toLowerCase()}`);
    }

    if (input.status === 'VERIFIED') {
      await postLedgerEntry(tx, {
        clientId: p.clientId,
        paymentId: p.id,
        entryType: LedgerEntryType.PAYMENT,
        amount: Number(p.amount),
        description: `Payment Verified: Receipt #${p.receiptNumber} (${p.paymentMethod})`,
      });
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: input.status as PaymentStatus,
        verifiedAt: input.status === 'VERIFIED' ? new Date() : undefined,
        verifiedById: user.id,
        notes: input.notes ? `${p.notes || ''}\nVerification: ${input.notes}`.trim() : p.notes,
      },
    });
    return p;
  });

  await createNotification({
    recipientId: payment.salesperson.userId,
    role: Role.SALESPERSON,
    title: input.status === 'VERIFIED' ? 'Payment Verified' : 'Payment Collection Rejected',
    message: `Payment collection ${payment.receiptNumber} for ₹${payment.amount} has been ${input.status.toLowerCase()}.`,
    type: 'PAYMENT_UPDATE',
  });
  await logAuditEvent({
    actor,
    action: 'VERIFY_PAYMENT',
    module: 'PAYMENT',
    recordId: paymentId,
    oldValue: { status: payment.status },
    newValue: { status: input.status, verifiedBy: user.name },
  });
  notifyPaymentVerified({ id: paymentId, receiptNumber: payment.receiptNumber, salespersonId: payment.salespersonId, status: input.status, amount: payment.amount });

  return { status: 200, body: { message: `Payment successfully marked as ${input.status}` } };
}
