import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieOptions } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const safeNext = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : null);

/**
 * Pages land here when the cookie is correctly signed but the session is no longer valid
 * (account deactivated or sessions revoked). Clears the cookie, then shows the login page.
 */
export function GET(req: NextRequest) {
  const url = new URL('/login', req.url);
  url.searchParams.set('expired', '1');
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  if (next) url.searchParams.set('next', next);
  const res = NextResponse.redirect(url, 303);
  const { name, ...opts } = sessionCookieOptions(0);
  res.cookies.set(name, '', opts);
  return res;
}
