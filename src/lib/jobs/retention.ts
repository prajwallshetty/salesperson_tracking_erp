import type { PrismaClient } from '@prisma/client';
import { prismaRoot, runWithTenant } from '@/lib/db';
import { logAuditEvent } from '@/lib/services/audit';
import { config } from '@/lib/config';

/**
 * Location-data retention. OFF unless LOCATION_RETENTION_DAYS is set (minimum 7): nothing is ever
 * deleted by default. When on, raw GPS points older than the cutoff are deleted in small batches,
 * across all companies, and an audit record is written for each company that lost points.
 * Sessions, attendance records, distances already stored on them, orders and visits are untouched —
 * only the point-by-point trail ages out.
 */
const BATCH = 5000;
export const MIN_RETENTION_DAYS = 7;

export async function purgeLocationPoints(db: PrismaClient, olderThan: Date): Promise<{ total: number; perTenant: Record<string, number> }> {
  const perTenant: Record<string, number> = {};
  for (;;) {
    const rows = await db.$queryRaw<{ tenantId: string }[]>`
      DELETE FROM "location_points"
      WHERE "id" IN (SELECT "id" FROM "location_points" WHERE "timestamp" < ${olderThan} LIMIT ${BATCH})
      RETURNING "tenantId"`;
    for (const r of rows) perTenant[r.tenantId] = (perTenant[r.tenantId] ?? 0) + 1;
    if (rows.length < BATCH) break;
  }
  return { total: Object.values(perTenant).reduce((a, b) => a + b, 0), perTenant };
}

export async function runRetention(days: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const result = await purgeLocationPoints(prismaRoot, cutoff);
  for (const [tenantId, deleted] of Object.entries(result.perTenant)) {
    await runWithTenant(tenantId, () =>
      logAuditEvent({ actor: { ip: 'retention-job' }, action: 'LOCATION_RETENTION_PURGE', module: 'TRACKING', newValue: { deleted, olderThan: cutoff.toISOString(), retentionDays: days } })
    );
  }
  if (result.total > 0) console.log(`[retention] deleted ${result.total} location point(s) older than ${days} days`);
  return result;
}

/** Starts the daily job when configured. Safe to call once at server start. */
export function startRetentionJob(): void {
  const days = config.locationRetentionDays;
  if (!days) return;
  const run = () => runRetention(days).catch((err) => console.error('[retention] failed:', err));
  setTimeout(run, 2 * 60_000).unref();
  setInterval(run, 24 * 60 * 60_000).unref();
  console.log(`[retention] location points older than ${days} days are purged daily`);
}
