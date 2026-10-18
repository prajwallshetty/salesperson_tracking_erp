'use client';

import AdminShell from '@/components/layout/AdminShell';
import BackLink from '@/components/ui/BackLink';
import DocumentEditor from '@/components/billing/DocumentEditor';

export default function NewInvoicePage() {
  return (
    <AdminShell title="New invoice">
      <div className="space-y-4">
        <BackLink href="/invoices" label="All invoices" />
        <DocumentEditor kind="invoice" />
      </div>
    </AdminShell>
  );
}
