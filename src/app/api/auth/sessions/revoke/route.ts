import { z } from 'zod';
import { Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { actorFrom } from '@/lib/services/audit';
import { assertCanRevokeSessions, revokeUserSessions } from '@/lib/services/sessions';

export const dynamic = 'force-dynamic';

const schema = z.object({ userId: z.string().uuid('Valid userId is required') });

/** Ends every session of another user (lost phone, staff leaving). Same scope as access-code revocation. */
export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER] }, async (ctx) => {
  const { userId } = schema.parse(await readJson(ctx.req));
  await assertCanRevokeSessions(ctx.user, userId);
  await revokeUserSessions(userId, actorFrom(ctx), `by ${ctx.user.role}`);
  return json({ message: 'All sessions for this user have been ended' });
});
