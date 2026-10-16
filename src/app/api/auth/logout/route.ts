import { NextResponse, type NextRequest } from 'next/server';
import { authenticateRequest, sessionCookieOptions } from '@/lib/auth/session';
import { logAuditEvent } from '@/lib/services/audit';
import { clientIp, userAgent } from '@/lib/http/request';

export const dynamic = 'force-dynamic';

/** Always clears the session cookie, even if the token already expired. */
export async function POST(req: NextRequest) {
  const { user } = await authenticateRequest(req).catch(() => ({ user: null }));
  if (user) {
    await logAuditEvent({ actor: { userId: user.id, ip: clientIp(req), userAgent: userAgent(req) }, action: 'LOGOUT', module: 'AUTH' });
  }
  const res = NextResponse.json({ message: 'Logged out successfully' });
  const { name, ...opts } = sessionCookieOptions(0);
  res.cookies.set(name, '', opts);
  return res;
}
