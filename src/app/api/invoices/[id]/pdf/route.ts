import { authedRoute } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { getInvoice } from '@/features/billing/invoices';
import { getBusinessProfile } from '@/features/billing/business';
import { invoicePdfData } from '@/features/billing/pdfData';
import { renderDocumentPdf } from '@/features/billing/pdf';
import { READ_OPTS, pdfResponse } from '@/features/billing/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = authedRoute<{ id: string }>(READ_OPTS, async ({ req, params }) => {
  const inv = await getInvoice(params.id);
  const pdf = await renderDocumentPdf(invoicePdfData(inv, await getBusinessProfile()));
  return pdfResponse(pdf, `Invoice-${inv.number ?? 'draft'}.pdf`, searchParams(req).get('download') === '1');
});
