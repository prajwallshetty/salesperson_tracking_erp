'use client';

import AdminShell from '@/components/layout/AdminShell';
import QuotationDetail from '@/components/billing/QuotationDetail';

export default function QuotationPage({ params }: { params: { id: string } }) {
  return (
    <AdminShell title="Quotation">
      <QuotationDetail id={params.id} />
    </AdminShell>
  );
}
