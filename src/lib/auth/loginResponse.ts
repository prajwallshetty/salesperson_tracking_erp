import { NextResponse } from 'next/server';
import { signSessionToken } from './tokens';
import { sessionCookieOptions } from './session';
import type { Role } from '@/lib/permissions';
import type { Tenant } from '@/lib/db';

interface LoginUserRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: string;
  tokenVersion?: number;
  salespersonProfile?: { id: string; employeeCode: string; territory: string; status: string } | null;
}

/**
 * Legacy login response body + the httpOnly session cookie used by the browser UI.
 * `remember` defaults to true: API clients that do not send it keep the legacy 7-day session.
 */
export function loginResponse(user: LoginUserRow, { remember = true, tenant }: { remember?: boolean; tenant?: Pick<Tenant, 'slug' | 'name'> } = {}): NextResponse {
  const token = signSessionToken(user.id, user.role, user.tokenVersion ?? 0, remember);
  const res = NextResponse.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      salespersonId: user.salespersonProfile?.id,
      employeeCode: user.salespersonProfile?.employeeCode,
      territory: user.salespersonProfile?.territory,
      dutyStatus: user.salespersonProfile?.status,
    },
    ...(tenant ? { tenant: { slug: tenant.slug, name: tenant.name } } : {}),
    expiresIn: remember ? '7d' : '12h',
    remember,
  });
  const { name, ...opts } = sessionCookieOptions(remember ? undefined : null);
  res.cookies.set(name, token, opts);
  return res;
}
