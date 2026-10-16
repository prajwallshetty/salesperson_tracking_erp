import { NextResponse } from 'next/server';
import { authedRoute } from '@/lib/http/handler';
import { sessionCookieOptions } from '@/lib/auth/session';
import { actorFrom } from '@/lib/services/audit';
import { revokeUserSessions } from '@/lib/services/sessions';

export const dynamic = 'force-dynamic';

/** "Sign out of all devices": invalidates every token issued to the caller, including this one. */
export const POST = authedRoute({}, async (ctx) => {
  await revokeUserSessions(ctx.user.id, actorFrom(ctx), 'self: sign out of all devices');
  const res = NextResponse.json({ message: 'Signed out of all devices' });
  const { name, ...opts } = sessionCookieOptions(0);
  res.cookies.set(name, '', opts);
  return res;
});
