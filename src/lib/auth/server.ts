import { cookies, headers } from 'next/headers';
import { PATH_HEADER, SESSION_COOKIE } from './constants';
import { resolveSessionToken } from './session';
import type { AuthenticatedUser } from '@/lib/permissions';

/** Session user for Server Components / layouts (reads the httpOnly cookie). */
export async function getServerSessionUser(): Promise<AuthenticatedUser | null> {
  const { user } = await resolveSessionToken(cookies().get(SESSION_COOKIE)?.value);
  return user;
}

/**
 * Where a layout sends a request whose cookie is signed but no longer valid (user deactivated,
 * sessions revoked). The route clears the cookie first; redirecting straight to /login would loop,
 * because the edge middleware only checks the signature and would send the user back.
 */
export const SESSION_ENDED_PATH = '/api/auth/session-ended';

/** SESSION_ENDED_PATH with the current page as the post-login return path. */
export function sessionEndedUrl(fallbackNext?: string): string {
  const next = headers().get(PATH_HEADER) || fallbackNext;
  return next ? `${SESSION_ENDED_PATH}?next=${encodeURIComponent(next)}` : SESSION_ENDED_PATH;
}

/** Strips server-only scope details before handing the user to the browser. */
export function toClientUser(u: AuthenticatedUser) {
  const { managedSalespersonIds: _ids, tokenVersion: _tv, tenantId: _tid, ...rest } = u;
  return rest;
}
export type ClientUser = ReturnType<typeof toClientUser>;
