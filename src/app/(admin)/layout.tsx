import { redirect } from 'next/navigation';
import { getServerSessionUser, toClientUser, sessionEndedUrl } from '@/lib/auth/server';
import { isConsoleUser } from '@/lib/permissions';
import { SessionProvider } from '@/components/shared/SessionProvider';
import { RealtimeProvider } from '@/components/shared/RealtimeProvider';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerSessionUser();
  if (!user) redirect(sessionEndedUrl());
  if (!isConsoleUser(user)) redirect('/field');
  return (
    <SessionProvider initialUser={toClientUser(user)}>
      <RealtimeProvider>{children}</RealtimeProvider>
    </SessionProvider>
  );
}
