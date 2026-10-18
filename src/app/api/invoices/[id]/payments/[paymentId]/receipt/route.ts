import { authedRoute, json } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { getInvoice } from '@/features/billing/invoices';
import { getBusinessProfile } from '@/features/billing/business';
import { receiptPdfData } from '@/features/billing/pdfData';
import { renderReceiptPdf } from '@/features/billing/pdf';
import { READ_OPTS, pdfResponse } from '@/features/billing/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = authedRoute<{ id: string; paymentId: string }>(READ_OPTS, async ({ req, params }) => {
  const inv = await getInvoice(params.id);
  const payment = inv.payments.find((p: any) => p.id === params.paymentId);
  if (!payment) return json({ error: 'Payment not found on this invoice' }, 404);
  const pdf = await renderReceiptPdf(receiptPdfData(inv, payment, await getBusinessProfile()));
  return pdfResponse(pdf, `Receipt-${payment.receiptNumber}.pdf`, searchParams(req).get('download') === '1');
});
