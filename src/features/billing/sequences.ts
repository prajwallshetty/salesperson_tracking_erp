import { prisma, TxClient, currentTenantId, DocumentKind, SequenceYearMode } from '@/lib/db';
import { businessDateString } from '@/lib/time';
import { sequenceSchema } from './schemas';
import { badRequest } from '@/lib/http/errors';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';

export const SEQUENCE_DEFAULTS: Record<DocumentKind, { prefix: string; padding: number }> = {
  QUOTATION: { prefix: 'QT-', padding: 4 },
  INVOICE: { prefix: 'INV-', padding: 4 },
  RECEIPT: { prefix: 'RCT-', padding: 4 },
};

/** Year part of a number: calendar year (2026) or Indian financial year (2026-27, April to March). */
export function yearToken(mode: SequenceYearMode, ymd: string): string | null {
  if (mode === 'NONE') return null;
  const year = Number(ymd.slice(0, 4));
  if (mode === 'CALENDAR') return String(year);
  const month = Number(ymd.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatDocumentNumber(seq: { prefix: string; padding: number }, token: string | null, n: number): string {
  return `${seq.prefix}${token ? `${token}-` : ''}${String(n).padStart(seq.padding, '0')}`;
}

async function numberTaken(tx: TxClient, kind: DocumentKind, number: string): Promise<boolean> {
  if (kind === 'QUOTATION') return !!(await tx.quotation.findFirst({ where: { number }, select: { id: true } }));
  if (kind === 'INVOICE') return !!(await tx.invoice.findFirst({ where: { number }, select: { id: true } }));
  return !!(await tx.invoicePayment.findFirst({ where: { receiptNumber: number }, select: { id: true } }));
}

/**
 * Takes the next number of a sequence inside the caller's transaction. The advisory lock serialises
 * concurrent callers for the company and kind until commit; the unique constraints on the document
 * tables are the backstop, and a number that is already in use (e.g. after the counter was moved by
 * hand) is skipped instead of failing.
 */
export async function takeNextNumber(tx: TxClient, kind: DocumentKind, on: Date = new Date()): Promise<string> {
  const tenantId = currentTenantId();
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `billing:${tenantId}:${kind}`);

  let seq = await tx.documentSequence.findFirst({ where: { kind } });
  if (!seq) seq = await tx.documentSequence.create({ data: { kind, ...SEQUENCE_DEFAULTS[kind] } });

  const token = yearToken(seq.yearMode, businessDateString(on));
  let next = seq.yearMode !== 'NONE' && seq.yearToken !== token ? 1 : seq.nextNumber;

  for (let i = 0; i < 1000; i++) {
    const number = formatDocumentNumber(seq, token, next);
    next += 1;
    if (!(await numberTaken(tx, kind, number))) {
      await tx.documentSequence.update({ where: { id: seq.id }, data: { nextNumber: next, yearToken: token } });
      return number;
    }
  }
  throw badRequest('Could not find a free document number; check the numbering settings.');
}

export async function listSequences() {
  const rows = await prisma.documentSequence.findMany();
  return (Object.keys(SEQUENCE_DEFAULTS) as DocumentKind[]).map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    const seq = row ?? { kind, ...SEQUENCE_DEFAULTS[kind], yearMode: 'NONE' as SequenceYearMode, yearToken: null, nextNumber: 1 };
    const token = yearToken(seq.yearMode, businessDateString());
    const useNext = seq.yearMode !== 'NONE' && seq.yearToken !== token ? 1 : seq.nextNumber;
    return {
      kind,
      prefix: seq.prefix,
      padding: seq.padding,
      yearMode: seq.yearMode,
      nextNumber: useNext,
      preview: formatDocumentNumber(seq, token, useNext),
    };
  });
}

export async function saveSequence(rawInput: unknown, actor: AuditActor) {
  const input = sequenceSchema.parse(rawInput);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `billing:${currentTenantId()}:${input.kind}`);
    const existing = await tx.documentSequence.findFirst({ where: { kind: input.kind } });
    const token = yearToken(input.yearMode, businessDateString());
    const data = { prefix: input.prefix, padding: input.padding, yearMode: input.yearMode, nextNumber: input.nextNumber, yearToken: token };
    if (existing) await tx.documentSequence.update({ where: { id: existing.id }, data });
    else await tx.documentSequence.create({ data: { kind: input.kind, ...data } });
  });
  await logAuditEvent({ actor, action: 'UPDATE_NUMBERING', module: 'BILLING_SETTINGS', newValue: input });
  return listSequences();
}
