'use client';

import AdminShell from '@/components/layout/AdminShell';
import BackLink from '@/components/ui/BackLink';
import EditLoader from '@/components/billing/EditLoader';

export default function EditQuotationPage({ params }: { params: { id: string } }) {
  return (
    <AdminShell title="Edit quotation">
      <div className="space-y-4">
        <BackLink href={`/quotations/${params.id}`} label="Back to quotation" />
        <EditLoader kind="quotation" id={params.id} />
      </div>
    </AdminShell>
  );
}
