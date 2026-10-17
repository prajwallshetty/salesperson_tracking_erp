import { Role } from '@/lib/db';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { reportTrackingState } from '@/features/tracking/service';

export const dynamic = 'force-dynamic';

/** The salesperson's phone reports its own tracking capability (permission denied, GPS off, …). */
export const POST = authedRoute({ roles: [Role.SALESPERSON] }, async ({ req, user }) => {
  const r = await reportTrackingState(user, await readJson(req));
  return json({ message: 'Tracking state recorded', state: r.state, at: r.at });
});
