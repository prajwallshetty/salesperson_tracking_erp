import { Prisma, LedgerEntryType, TxClient, currentTenantId } from '@/lib/db';
import { notFound } from '@/lib/http/errors';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Locks the client row (SELECT … FOR UPDATE) and returns its current outstanding balance.
 * Legacy defect fixed: balances were read outside the transaction, so concurrent order and
 * payment postings could overwrite each other's running balance.
 */
export async function lockClientOutstanding(tx: TxClient, clientId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ currentOutstanding: Prisma.Decimal }[]>`
    SELECT "currentOutstanding" FROM "clients" WHERE "id" = ${clientId} AND "tenantId" = ${currentTenantId()} FOR UPDATE`;
  if (!rows.length) throw notFound('Client not found');
  return Number(rows[0].currentOutstanding);
}

/**
 * Posts a ledger entry and updates the client's outstanding balance atomically.
 *  - INVOICE / OPENING_BALANCE increase the balance.
 *  - PAYMENT / REVERSAL decrease it, floored at zero (legacy `Math.max(0, …)` rule).
 */
export async function postLedgerEntry(
  tx: TxClient,
  entry: {
    clientId: string;
    entryType: LedgerEntryType;
    amount: number;
    description: string;
    orderId?: string;
    paymentId?: string;
  }
): Promise<number> {
  const current = await lockClientOutstanding(tx, entry.clientId);
  const increases = entry.entryType === LedgerEntryType.INVOICE || entry.entryType === LedgerEntryType.OPENING_BALANCE;
  const next = increases ? round2(current + entry.amount) : Math.max(0, round2(current - entry.amount));

  await tx.client.update({ where: { id: entry.clientId }, data: { currentOutstanding: next } });
  await tx.clientLedgerEntry.create({
    data: {
      clientId: entry.clientId,
      orderId: entry.orderId,
      paymentId: entry.paymentId,
      entryType: entry.entryType,
      amount: entry.amount,
      runningBalance: next,
      description: entry.description,
    },
  });
  return next;
}
