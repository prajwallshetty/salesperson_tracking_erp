'use client';

import AdminShell from '@/components/layout/AdminShell';
import BackLink from '@/components/ui/BackLink';
import DocumentEditor from '@/components/billing/DocumentEditor';

export default function NewQuotationPage() {
  return (
    <AdminShell title="New quotation">
      <div className="space-y-4">
        <BackLink href="/quotations" label="All quotations" />
        <DocumentEditor kind="quotation" />
      </div>
    </AdminShell>
  );
}
