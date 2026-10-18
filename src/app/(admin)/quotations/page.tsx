'use client';

import { Suspense } from 'react';
import AdminShell from '@/components/layout/AdminShell';
import DocumentList from '@/components/billing/DocumentList';

export default function QuotationsPage() {
  return (
    <AdminShell title="Quotations">
      <Suspense fallback={null}>
        <DocumentList kind="quotation" />
      </Suspense>
    </AdminShell>
  );
}
