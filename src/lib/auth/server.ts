import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './constants';
import { verifySessionToken } from './tokens';
import { loadAuthenticatedUser } from './session';
import type { AuthenticatedUser } from '@/lib/permissions';

/** Session user for Server Components / layouts (reads the httpOnly cookie). */
export async function getServerSessionUser(): Promise<AuthenticatedUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return loadAuthenticatedUser(payload.userId);
}

/** Strips server-only scope details before handing the user to the browser. */
export function toClientUser(u: AuthenticatedUser) {
  const { managedSalespersonIds: _ids, ...rest } = u;
  return rest;
}
export type ClientUser = ReturnType<typeof toClientUser>;
