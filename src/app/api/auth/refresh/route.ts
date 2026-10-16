import { NextResponse } from 'next/server';
import { authedRoute } from '@/lib/http/handler';
import { signSessionToken } from '@/lib/auth/tokens';
import { sessionCookieOptions } from '@/lib/auth/session';
import { REFRESH_MIN_AGE_SECONDS } from '@/lib/auth/constants';

export const dynamic = 'force-dynamic';

/**
 * Sliding session renewal. Requires a currently valid token (an expired session must log in
 * again) and re-reads the user from the database, so a deactivated account cannot refresh.
 */
export const POST = authedRoute({}, async ({ user, tokenIat }) => {
  const ageSeconds = tokenIat ? Math.floor(Date.now() / 1000) - tokenIat : Infinity;
  if (ageSeconds < REFRESH_MIN_AGE_SECONDS) return NextResponse.json({ refreshed: false });
  const token = signSessionToken(user.id, user.role, user.tokenVersion ?? 0);
  const res = NextResponse.json({ refreshed: true, token, expiresIn: '7d' });
  const { name, ...opts } = sessionCookieOptions();
  res.cookies.set(name, token, opts);
  return res;
});
