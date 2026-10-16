import { NextResponse } from 'next/server';
import { signSessionToken } from './tokens';
import { sessionCookieOptions } from './session';
import type { Role } from '@/lib/permissions';

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

/** Legacy login response body + the httpOnly session cookie used by the browser UI. */
export function loginResponse(user: LoginUserRow): NextResponse {
  const token = signSessionToken(user.id, user.role, user.tokenVersion ?? 0);
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
    expiresIn: '7d',
  });
  const { name, ...opts } = sessionCookieOptions();
  res.cookies.set(name, token, opts);
  return res;
}
