import type { NextRequest } from 'next/server';
import { prisma, UserStatus } from '@/lib/db';
import { config } from '@/lib/config';
import { DEFAULT_MANAGER_PERMISSIONS, MANAGER_PERMISSION_KEYS, type AuthenticatedUser, type PermissionMap } from '@/lib/permissions';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './constants';
import { verifySessionToken } from './tokens';

/**
 * Token lookup order:
 *  1. `Authorization: Bearer <jwt>` (legacy API contract; native/API clients)
 *  2. httpOnly session cookie (browser UI)
 *  3. `?token=` query (legacy contract for receipt-PDF/CSV links opened in a new tab)
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
  const url = new URL(req.url);
  const q = url.searchParams.get('token');
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
export async function loadAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      salespersonProfile: true,
      managerPermissions: true,
      managedSalespersons: { select: { salespersonId: true } },
    },
  });
  if (!user || user.status !== UserStatus.ACTIVE) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    salespersonId: user.salespersonProfile?.id,
    employeeCode: user.salespersonProfile?.employeeCode,
    territory: user.salespersonProfile?.territory,
    managedSalespersonIds: user.managedSalespersons.map((m) => m.salespersonId),
    permissions: user.role === 'MANAGER' ? toPermissionMap(user.managerPermissions) : undefined,
  };
}

export async function authenticateRequest(req: NextRequest | Request): Promise<{ user: AuthenticatedUser | null; tokenIat?: number }> {
  const token = extractToken(req);
  if (!token) return { user: null };
  const payload = verifySessionToken(token);
  if (!payload) return { user: null };
  return { user: await loadAuthenticatedUser(payload.userId), tokenIat: payload.iat };
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
