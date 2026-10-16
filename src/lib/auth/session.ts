import type { NextRequest } from 'next/server';
import { prisma, UserStatus } from '@/lib/db';
import { config } from '@/lib/config';
import { DEFAULT_MANAGER_PERMISSIONS, MANAGER_PERMISSION_KEYS, type AuthenticatedUser, type PermissionMap } from '@/lib/permissions';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './constants';
import { verifySessionToken, type TokenPayload } from './tokens';

/**
 * Token lookup order:
 *  1. `Authorization: Bearer <jwt>` (legacy API contract; native/API clients)
 *  2. httpOnly session cookie (browser UI)
 *  3. `?token=` query — legacy contract for links opened in a new tab. Off by default because
 *     URLs end up in logs, history and Referer headers; set ALLOW_QUERY_TOKEN=true to restore it
 *     for an old client during rollout. The browser UI never needs it (it uses the cookie).
 */
export function extractToken(req: NextRequest | Request): string | null {
  const header = req.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const t = header.slice(7).trim();
    if (t && t !== 'null' && t !== 'undefined') return t;
  }
  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (match) {
      const value = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
      if (value) return value;
    }
  }
  if (!config.allowQueryToken) return null;
  const q = new URL(req.url).searchParams.get('token');
  return q || null;
}

function toPermissionMap(row: Partial<Record<string, unknown>> | null): PermissionMap {
  const map = { ...DEFAULT_MANAGER_PERMISSIONS };
  if (row) {
    for (const key of MANAGER_PERMISSION_KEYS) {
      if (typeof row[key] === 'boolean') map[key] = row[key] as boolean;
    }
  }
  return map;
}

/**
 * Loads the user fresh from the database on every request (legacy behaviour):
 * deactivated users and changed roles/team assignments take effect immediately,
 * and nothing in the token can elevate role or scope.
 */
export async function loadAuthenticatedUser(userId: string, tokenVersion?: number): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      salespersonProfile: true,
      managerPermissions: true,
      managedSalespersons: { select: { salespersonId: true } },
    },
  });
  if (!user || user.status !== UserStatus.ACTIVE) return null;
  // Sessions issued before the user's last "sign out everywhere" are no longer valid.
  if (tokenVersion !== undefined && tokenVersion !== user.tokenVersion) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    tokenVersion: user.tokenVersion,
    salespersonId: user.salespersonProfile?.id,
    employeeCode: user.salespersonProfile?.employeeCode,
    territory: user.salespersonProfile?.territory,
    managedSalespersonIds: user.managedSalespersons.map((m) => m.salespersonId),
    permissions: user.role === 'MANAGER' ? toPermissionMap(user.managerPermissions) : undefined,
  };
}

/** Verifies a session token and loads its user; the single check used by API, pages and sockets. */
export async function resolveSessionToken(token: string | null | undefined): Promise<{ user: AuthenticatedUser | null; payload?: TokenPayload }> {
  if (!token) return { user: null };
  const payload = verifySessionToken(token);
  if (!payload) return { user: null };
  return { user: await loadAuthenticatedUser(payload.userId, payload.tv), payload };
}

export async function authenticateRequest(req: NextRequest | Request): Promise<{ user: AuthenticatedUser | null; tokenIat?: number }> {
  const { user, payload } = await resolveSessionToken(extractToken(req));
  return { user, tokenIat: payload?.iat };
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
    path: '/',
    maxAge,
  };
}
