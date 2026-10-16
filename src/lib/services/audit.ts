import { prisma, Prisma } from '@/lib/db';

export interface AuditActor {
  userId?: string | null;
  ip?: string;
  userAgent?: string;
}

/** Writes an audit log row. Never throws (legacy behaviour): auditing must not break the request. */
export async function logAuditEvent(params: {
  actor?: AuditActor;
  action: string;
  module: string;
  recordId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  try {
    const toJson = (v: unknown) =>
      v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);
    await prisma.auditLog.create({
      data: {
        userId: params.actor?.userId ?? null,
        action: params.action,
        module: params.module,
        recordId: params.recordId ? String(params.recordId) : null,
        oldValue: toJson(params.oldValue),
        newValue: toJson(params.newValue),
        ip: params.actor?.ip ?? '127.0.0.1',
        device: String(params.actor?.userAgent ?? 'Unknown Device').slice(0, 255),
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

/** Convenience: build an actor from a route context. */
export function actorFrom(ctx: { user?: { id: string } | null; ip: string; userAgent: string }): AuditActor {
  return { userId: ctx.user?.id ?? null, ip: ctx.ip, userAgent: ctx.userAgent };
}
