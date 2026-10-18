'use client';

import AdminShell from '@/components/layout/AdminShell';
import BackLink from '@/components/ui/BackLink';
import EditLoader from '@/components/billing/EditLoader';

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  return (
    <AdminShell title="Edit invoice">
      <div className="space-y-4">
        <BackLink href={`/invoices/${params.id}`} label="Back to invoice" />
        <EditLoader kind="invoice" id={params.id} />
      </div>
    </AdminShell>
  );
}
