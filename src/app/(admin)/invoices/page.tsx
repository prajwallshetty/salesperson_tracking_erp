'use client';

import { Suspense } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import DocumentList from '@/components/billing/DocumentList';

export default function InvoicesPage() {
  return (
    <AdminShell title="Invoices">
      <Suspense fallback={null}>
        <DocumentList kind="invoice" />
      </Suspense>
    </AdminShell>
  );
}
