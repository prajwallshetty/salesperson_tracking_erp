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
export const POST = authedRoute({}, async ({ user, tokenIat, tokenRemember }) => {
  const ageSeconds = tokenIat ? Math.floor(Date.now() / 1000) - tokenIat : Infinity;
  if (ageSeconds < REFRESH_MIN_AGE_SECONDS) return NextResponse.json({ refreshed: false });
  // Keeps the session's "Remember me" choice (persistent 7-day vs. session cookie / 12-hour token).
  const remember = tokenRemember !== false;
  const token = signSessionToken(user.id, user.role, user.tokenVersion ?? 0, remember);
  const res = NextResponse.json({ refreshed: true, token, expiresIn: remember ? '7d' : '12h', remember });
  const { name, ...opts } = sessionCookieOptions(remember ? undefined : null);
  res.cookies.set(name, token, opts);
  return res;
});
