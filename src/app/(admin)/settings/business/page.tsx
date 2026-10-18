'use client';

import AdminShell from '@/components/layout/AdminShell';
import BackLink from '@/components/ui/BackLink';
import BusinessSettings from '@/components/billing/BusinessSettings';

export default function BusinessSettingsPage() {
  return (
    <AdminShell title="Business details">
      <div className="space-y-4">
        <BackLink href="/settings" label="Settings" />
        <BusinessSettings />
      </div>
    </AdminShell>
  );
}
