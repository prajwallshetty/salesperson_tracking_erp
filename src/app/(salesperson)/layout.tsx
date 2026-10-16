import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSessionUser, toClientUser } from '@/lib/auth/server';
import { SessionProvider } from '@/components/shared/SessionProvider';
import { RealtimeProvider } from '@/components/shared/RealtimeProvider';
import { FieldProvider } from '@/features/field/FieldProvider';
import FieldShell from '@/components/sales/FieldShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Field' };

export default async function SalespersonLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerSessionUser();
  if (!user) redirect('/login?next=/field');
  if (user.role !== 'SALESPERSON') redirect('/dashboard');
  if (!user.salespersonId) redirect('/login');
  return (
    <SessionProvider initialUser={toClientUser(user)}>
      <RealtimeProvider toasts={false}>
        <FieldProvider>
          <FieldShell>{children}</FieldShell>
        </FieldProvider>
      </RealtimeProvider>
    </SessionProvider>
  );
}
