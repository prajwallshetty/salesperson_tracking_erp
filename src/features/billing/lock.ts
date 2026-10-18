import { TxClient, currentTenantId } from '@/lib/db';
import { notFound } from '@/lib/http/errors';

const TABLES = { quotations: 'quotations', invoices: 'invoices' } as const;

/** Row lock (SELECT … FOR UPDATE) on one of the current company's documents; serialises concurrent changes to it. */
export async function lockDocument(tx: TxClient, table: keyof typeof TABLES, id: string): Promise<void> {
  // The table name comes from the constant map above, never from input; id and tenant are bound parameters.
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${TABLES[table]}" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE`, id, currentTenantId());
  if (!rows.length) throw notFound(table === 'quotations' ? 'Quotation not found' : 'Invoice not found');
}

/** Makes a Prisma result (Decimals, Dates) safe to send as JSON. */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
