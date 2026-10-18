'use client';

import AdminShell from '@/components/layout/AdminShell';
import InvoiceDetail from '@/components/billing/InvoiceDetail';

export default function InvoicePage({ params }: { params: { id: string } }) {
  return (
    <AdminShell title="Invoice">
      <InvoiceDetail id={params.id} />
    </AdminShell>
  );
}
