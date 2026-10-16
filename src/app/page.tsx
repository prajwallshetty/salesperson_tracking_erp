import { redirect } from 'next/navigation';
import { getServerSessionUser, SESSION_ENDED_PATH } from '@/lib/auth/server';
import { homePathForRole } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/** Entry point: route each role to its own interface (middleware usually handles this first). */
export default async function Home() {
  const user = await getServerSessionUser();
  redirect(user ? homePathForRole(user.role) : SESSION_ENDED_PATH);
}
