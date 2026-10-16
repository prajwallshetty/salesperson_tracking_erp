import { prisma } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { canAccessSalesperson } from '@/lib/permissions';
import { renderPaymentReceiptPdf } from '@/features/payments/receiptPdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = authedRoute<{ id: string }>({}, async ({ user, params }) => {
  const payment = await prisma.payment.findUnique({
    where: { id: params.id },
    include: { client: true, salesperson: { include: { user: true } }, verifiedBy: true },
  });
  if (!payment) return json({ error: 'Payment not found' }, 404);
  // Legacy defect fixed: any authenticated user could download any receipt.
  if (!canAccessSalesperson(user, payment.salespersonId)) return json({ error: 'Access denied to this payment' }, 403);

  const pdf = await renderPaymentReceiptPdf({
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
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="receipt-${payment.receiptNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
