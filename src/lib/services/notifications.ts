import { prisma, Prisma, type Role, TxClient } from '@/lib/db';
import { notifyInAppNotification } from '@/lib/realtime/emitter';

type Client = TxClient | typeof prisma;

/** Persists an in-app notification and pushes it over the realtime channel. */
export async function createNotification(
  data: {
    recipientId?: string | null;
    role?: Role | null;
    title: string;
    message: string;
    type?: string;
    metadata?: Prisma.InputJsonValue;
  },
  db: Client = prisma
) {
  const n = await db.notification.create({
    data: {
      recipientId: data.recipientId ?? null,
      role: data.role ?? null,
      title: data.title,
      message: data.message,
      type: data.type ?? 'INFO',
      metadata: data.metadata,
    },
  });
  notifyInAppNotification(n.recipientId, n.role, n);
  return n;
}

/**
 * Notifications visible to a user. Legacy semantics: addressed to them directly, or broadcast
 * to their role *without* a specific recipient (role-only broadcasts).
 */
export function notificationScope(user: { id: string; role: Role }): Prisma.NotificationWhereInput {
  return {
    OR: [{ recipientId: user.id }, { role: user.role, recipientId: null }],
  };
}
