import { prisma, Prisma } from '@/lib/db';

export interface StoredResponse {
  status: number;
  body: any;
}

/** Legacy contract: a repeated idempotency key replays the original status + body. */
export async function findIdempotentResponse(key?: string | null): Promise<StoredResponse | null> {
  if (!key) return null;
  const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
  return existing ? { status: existing.responseCode, body: existing.responseBody } : null;
}

/**
 * Records the response *inside* the business transaction, so a concurrent duplicate request
 * fails on the unique key and rolls back its side effects instead of creating a second record.
 */
export async function storeIdempotentResponse(
  tx: Prisma.TransactionClient,
  key: string | undefined | null,
  data: { endpoint: string; salespersonId?: string | null; status: number; body: unknown }
) {
  if (!key) return;
  await tx.idempotencyKey.create({
    data: {
      key,
      endpoint: data.endpoint,
      salespersonId: data.salespersonId ?? null,
      responseCode: data.status,
      responseBody: JSON.parse(JSON.stringify(data.body)) as Prisma.InputJsonValue,
    },
  });
}
