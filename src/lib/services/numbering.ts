import { Prisma, TxClient, currentTenantId } from '@/lib/db';

/**
 * Document numbers: ORD-YYYY-000001, PAY-YYYY-00001, EXP-YYYY-000001 (legacy formats).
 *
 * Legacy used `count() + 1`, which collides under concurrency and after deletions.
 * We take the highest numeric suffix across *all* existing numbers (so the sequence continues
 * exactly where the legacy one left off, including across years) and rely on the unique
 * transaction-scoped advisory lock (plus `withUniqueRetry` as a backstop) to resolve races.
 */
const SPECS = {
  order: { table: 'orders', column: 'orderNumber', prefix: 'ORD', width: 6 },
  payment: { table: 'payments', column: 'receiptNumber', prefix: 'PAY', width: 5 },
  expense: { table: 'expenses', column: 'expenseNumber', prefix: 'EXP', width: 6 },
} as const;

export type NumberedDocument = keyof typeof SPECS;

export async function nextDocumentNumber(tx: TxClient, kind: NumberedDocument, now = new Date()): Promise<string> {
  const spec = SPECS[kind];
  // Serialise number assignment per document type until this transaction commits, so parallel
  // requests never compute the same "next" value. Released automatically at COMMIT/ROLLBACK.
  // Numbers are per company: the lock and the MAX() are both scoped to the current tenant.
  const tenantId = currentTenantId();
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `salesgrid:${tenantId}:${kind}_number`);
  // Identifiers come from the constant table above, never from user input; the tenant id is a bound parameter.
  const rows = await tx.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING("${spec.column}" FROM '^${spec.prefix}-[0-9]{4}-([0-9]+)$') AS BIGINT))::int AS max FROM "${spec.table}" WHERE "tenantId" = $1`,
    tenantId
  );
  const next = (rows[0]?.max ?? 0) + 1;
  return `${spec.prefix}-${now.getFullYear()}-${String(next).padStart(spec.width, '0')}`;
}

export const isUniqueViolation = (err: unknown): err is Prisma.PrismaClientKnownRequestError =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Re-runs `fn` when a unique constraint is hit (e.g. two requests took the same number). */
export async function withUniqueRetry<T>(fn: (attempt: number) => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}
