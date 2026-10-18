import { authedRoute } from '@/lib/http/handler';
import { searchParams } from '@/lib/http/request';
import { getQuotation } from '@/features/billing/quotations';
import { getBusinessProfile } from '@/features/billing/business';
import { quotationPdfData } from '@/features/billing/pdfData';
import { renderDocumentPdf } from '@/features/billing/pdf';
import { READ_OPTS, pdfResponse } from '@/features/billing/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = authedRoute<{ id: string }>(READ_OPTS, async ({ req, params }) => {
  const q = await getQuotation(params.id);
  const pdf = await renderDocumentPdf(quotationPdfData(q, await getBusinessProfile()));
  const suffix = q.revision > 1 ? `-R${q.revision}` : '';
  return pdfResponse(pdf, `Quotation-${q.number}${suffix}.pdf`, searchParams(req).get('download') === '1');
});
