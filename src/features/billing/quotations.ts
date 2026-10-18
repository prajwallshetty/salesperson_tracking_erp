import { prisma, Prisma, type QuotationStatus } from '@/lib/db';
import { badRequest, conflict, notFound } from '@/lib/http/errors';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import type { AuthenticatedUser } from '@/lib/permissions';
import { takeNextNumber } from './sequences';
import { getBusinessProfile, snapshotBusiness } from './business';
import { quotationInputSchema, quotationResponseSchema, type QuotationInput } from './schemas';
import { addDays, computeDocument, draftFromStored, resolveCustomer, todayYmd, ymdToDate } from './documents';
import { lockDocument, plain } from './lock';

const ITEM_ORDER = { orderBy: { position: 'asc' as const } };

const EDITABLE: QuotationStatus[] = ['DRAFT'];
const REVISABLE: QuotationStatus[] = ['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

/** SENT quotations past their validity date become EXPIRED (idempotent; runs before reads). */
export async function expireQuotations(): Promise<number> {
  const { count } = await prisma.quotation.updateMany({
    where: { status: 'SENT', validUntil: { lt: ymdToDate(todayYmd()) } },
    data: { status: 'EXPIRED' },
  });
  if (count > 0) await logAuditEvent({ action: 'EXPIRE_QUOTATIONS', module: 'QUOTATION', newValue: { count } });
  return count;
}

function summary(q: { number: string; revision: number; status: string; grandTotal: unknown; customerName: string }) {
  return { number: q.number, revision: q.revision, status: q.status, grandTotal: Number(q.grandTotal), customer: q.customerName };
}

async function datesFor(input: { quotationDate?: string; validUntil?: string }) {
  const profile = await getBusinessProfile();
  const quotationDate = input.quotationDate ?? todayYmd();
  const validUntil = input.validUntil ?? addDays(quotationDate, profile.quotationValidityDays);
  if (validUntil < quotationDate) throw badRequest('Valid-until date cannot be before the quotation date');
  return { profile, quotationDate, validUntil };
}

export async function createQuotation(user: AuthenticatedUser, rawInput: unknown, actor: AuditActor) {
  const input = quotationInputSchema.parse(rawInput);
  const { profile, quotationDate, validUntil } = await datesFor(input);
  const customer = await resolveCustomer(user, input);
  const computed = computeDocument(input, profile, customer.customerState);

  const created = await prisma.$transaction(async (tx) => {
    const number = await takeNextNumber(tx, 'QUOTATION');
    return tx.quotation.create({
      data: {
        groupId: crypto.randomUUID(),
        revision: 1,
        number,
        status: 'DRAFT',
        ...customer,
        quotationDate: ymdToDate(quotationDate),
        validUntil: ymdToDate(validUntil),
        ...computed.header,
        paymentTerms: input.paymentTerms ?? profile.defaultPaymentTerms ?? null,
        notes: input.notes ?? profile.quotationNotes ?? null,
        terms: input.terms ?? profile.quotationTerms ?? null,
        createdById: user.id,
        items: { create: computed.items },
      },
      include: { items: ITEM_ORDER },
    });
  });
  await logAuditEvent({ actor, action: 'CREATE_QUOTATION', module: 'QUOTATION', recordId: created.id, newValue: summary(created) });
  return plain(created);
}

export async function updateQuotation(user: AuthenticatedUser, id: string, rawInput: unknown, actor: AuditActor) {
  const input = quotationInputSchema.parse(rawInput);
  const customer = await resolveCustomer(user, input);
  const profile = await getBusinessProfile();

  const result = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'quotations', id);
    const current = await tx.quotation.findUniqueOrThrow({ where: { id } });
    if (!EDITABLE.includes(current.status)) throw conflict('Only draft quotations can be edited. Revise the quotation to change a sent one.');

    const quotationDate = input.quotationDate ?? current.quotationDate.toISOString().slice(0, 10);
    const validUntil = input.validUntil ?? current.validUntil.toISOString().slice(0, 10);
    if (validUntil < quotationDate) throw badRequest('Valid-until date cannot be before the quotation date');
    const computed = computeDocument(input, profile, customer.customerState);

    await tx.quotationItem.deleteMany({ where: { quotationId: id } });
    const updated = await tx.quotation.update({
      where: { id },
      data: {
        ...customer,
        quotationDate: ymdToDate(quotationDate),
        validUntil: ymdToDate(validUntil),
        ...computed.header,
        paymentTerms: input.paymentTerms ?? null,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        items: { create: computed.items },
      },
      include: { items: ITEM_ORDER },
    });
    return { current, updated };
  });
  await logAuditEvent({ actor, action: 'UPDATE_QUOTATION', module: 'QUOTATION', recordId: id, oldValue: summary(result.current), newValue: summary(result.updated) });
  return plain(result.updated);
}

export async function deleteQuotation(id: string, actor: AuditActor) {
  const removed = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'quotations', id);
    const q = await tx.quotation.findUniqueOrThrow({ where: { id } });
    if (q.status !== 'DRAFT') throw conflict('Only draft quotations can be deleted');
    if (q.revision > 1) throw conflict('A draft revision cannot be deleted because it would erase part of the revision history. Edit it instead.');
    await tx.quotation.delete({ where: { id } });
    return q;
  });
  await logAuditEvent({ actor, action: 'DELETE_QUOTATION', module: 'QUOTATION', recordId: id, oldValue: summary(removed) });
}

/** DRAFT → SENT: freezes the business details printed on it and blocks further edits. */
export async function markQuotationSent(id: string, actor: AuditActor) {
  const sent = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'quotations', id);
    const q = await tx.quotation.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (q.status !== 'DRAFT') throw conflict(`Quotation is already ${q.status.toLowerCase()}`);
    if (!q.items.length) throw badRequest('Add at least one item before sending');
    if (q.validUntil < ymdToDate(todayYmd())) throw badRequest('The valid-until date has passed; extend it before sending');
    return tx.quotation.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), businessSnapshot: (await snapshotBusiness(tx)) as unknown as Prisma.InputJsonValue }, include: { items: ITEM_ORDER } });
  });
  await logAuditEvent({ actor, action: 'SEND_QUOTATION', module: 'QUOTATION', recordId: id, oldValue: { status: 'DRAFT' }, newValue: summary(sent) });
  return plain(sent);
}

export async function respondToQuotation(id: string, rawInput: unknown, actor: AuditActor) {
  const input = quotationResponseSchema.parse(rawInput);
  if (input.decision === 'REJECTED' && !input.reason) throw badRequest('Give a reason for rejecting the quotation');
  await expireQuotations();
  const done = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'quotations', id);
    const q = await tx.quotation.findUniqueOrThrow({ where: { id } });
    if (q.status !== 'SENT') throw conflict(q.status === 'EXPIRED' ? 'This quotation has expired. Revise it to extend the validity.' : `Only a sent quotation can be ${input.decision.toLowerCase()} (it is ${q.status.toLowerCase()})`);
    const updated = await tx.quotation.update({
      where: { id },
      data: { status: input.decision, respondedAt: new Date(), rejectionReason: input.decision === 'REJECTED' ? input.reason : null },
      include: { items: ITEM_ORDER },
    });
    return { before: q, updated };
  });
  await logAuditEvent({ actor, action: `${input.decision}_QUOTATION`, module: 'QUOTATION', recordId: id, oldValue: { status: done.before.status }, newValue: { status: input.decision, reason: input.reason } });
  return plain(done.updated);
}

/** Creates the next revision as a new draft; the revision it replaces is kept unchanged and marked REVISED. */
export async function reviseQuotation(id: string, actor: AuditActor) {
  await expireQuotations();
  const profile = await getBusinessProfile();
  const result = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'quotations', id);
    const source = await tx.quotation.findUniqueOrThrow({ where: { id }, include: { items: ITEM_ORDER } });
    if (!REVISABLE.includes(source.status)) {
      throw conflict(source.status === 'DRAFT' ? 'A draft can simply be edited' : 'This revision has already been replaced by a newer one');
    }
    if (source.status === 'ACCEPTED') {
      const live = await tx.invoice.findFirst({ where: { quotationId: id, status: { not: 'CANCELLED' } }, select: { number: true } });
      if (live) throw conflict('This quotation has already been converted to an invoice and can no longer be revised');
    }
    const latest = await tx.quotation.aggregate({ where: { groupId: source.groupId }, _max: { revision: true } });
    const today = todayYmd();
    const { id: _id, createdAt: _c, updatedAt: _u, items, ...rest } = source;
    const created = await tx.quotation.create({
      data: {
        ...rest,
        revision: (latest._max.revision ?? source.revision) + 1,
        status: 'DRAFT',
        quotationDate: ymdToDate(today),
        validUntil: ymdToDate(addDays(today, profile.quotationValidityDays)),
        sentAt: null,
        respondedAt: null,
        rejectionReason: null,
        businessSnapshot: Prisma.DbNull,
        revisionOfId: source.id,
        items: { create: items.map(({ id: _i, quotationId: _q, ...item }) => item) },
      },
      include: { items: ITEM_ORDER },
    });
    await tx.quotation.update({ where: { id }, data: { status: 'REVISED' } });
    return { source, created };
  });
  await logAuditEvent({
    actor,
    action: 'REVISE_QUOTATION',
    module: 'QUOTATION',
    recordId: id,
    oldValue: summary(result.source),
    newValue: { newRevisionId: result.created.id, revision: result.created.revision },
  });
  return plain(result.created);
}

/** A fresh draft with its own number, copied from any quotation. */
export async function duplicateQuotation(user: AuthenticatedUser, id: string, actor: AuditActor) {
  const source = await prisma.quotation.findUnique({ where: { id }, include: { items: ITEM_ORDER } });
  if (!source) throw notFound('Quotation not found');
  const profile = await getBusinessProfile();
  const draft = draftFromStored(source as any);
  const customer = await resolveCustomer(user, draft);
  const today = todayYmd();
  const computed = computeDocument({ ...draft, taxMode: source.taxMode }, profile, customer.customerState);
  const created = await prisma.$transaction(async (tx) => {
    const number = await takeNextNumber(tx, 'QUOTATION');
    return tx.quotation.create({
      data: {
        groupId: crypto.randomUUID(),
        revision: 1,
        number,
        status: 'DRAFT',
        ...customer,
        quotationDate: ymdToDate(today),
        validUntil: ymdToDate(addDays(today, profile.quotationValidityDays)),
        ...computed.header,
        paymentTerms: source.paymentTerms,
        notes: source.notes,
        terms: source.terms,
        createdById: user.id,
        items: { create: computed.items },
      },
      include: { items: ITEM_ORDER },
    });
  });
  await logAuditEvent({ actor, action: 'DUPLICATE_QUOTATION', module: 'QUOTATION', recordId: created.id, oldValue: { sourceId: id, number: source.number }, newValue: summary(created) });
  return plain(created);
}

export interface ListQuery {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  clientId?: string;
  sort?: string;
  dir?: string;
  includeRevisions?: boolean;
  limit: number;
  offset: number;
}

const SORTS: Record<string, string> = { date: 'quotationDate', number: 'number', total: 'grandTotal', customer: 'customerName', validUntil: 'validUntil', created: 'createdAt' };

export async function listQuotations(query: ListQuery) {
  await expireQuotations();
  const where: Prisma.QuotationWhereInput = {};
  if (!query.includeRevisions) where.status = { not: 'REVISED' };
  if (query.status) where.status = query.status as QuotationStatus;
  if (query.clientId) where.clientId = query.clientId;
  if (query.from || query.to) where.quotationDate = { ...(query.from ? { gte: ymdToDate(query.from) } : {}), ...(query.to ? { lte: ymdToDate(query.to) } : {}) };
  if (query.q) {
    where.OR = [
      { number: { contains: query.q, mode: 'insensitive' } },
      { customerName: { contains: query.q, mode: 'insensitive' } },
      { customerPhone: { contains: query.q } },
    ];
  }
  const sortField = SORTS[query.sort ?? ''] ?? 'createdAt';
  const [rows, total] = await Promise.all([
    prisma.quotation.findMany({ where, orderBy: [{ [sortField]: query.dir === 'asc' ? 'asc' : 'desc' }, { createdAt: 'desc' }], take: query.limit, skip: query.offset }),
    prisma.quotation.count({ where }),
  ]);
  return { data: plain(rows), total };
}

export async function getQuotation(id: string) {
  await expireQuotations();
  const q = await prisma.quotation.findUnique({ where: { id }, include: { items: ITEM_ORDER, invoices: { select: { id: true, number: true, status: true } } } });
  if (!q) throw notFound('Quotation not found');
  const revisions = await prisma.quotation.findMany({
    where: { groupId: q.groupId },
    orderBy: { revision: 'asc' },
    select: { id: true, revision: true, status: true, quotationDate: true, validUntil: true, grandTotal: true, createdAt: true },
  });
  const history = await prisma.auditLog.findMany({
    where: { module: 'QUOTATION', recordId: { in: revisions.map((r) => r.id) } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, action: true, recordId: true, oldValue: true, newValue: true, createdAt: true, user: { select: { name: true } } },
  });
  return plain({ ...q, revisions, history });
}

/**
 * Accepted quotation → draft invoice. Customer, line items, prices and tax figures are copied exactly
 * as saved on the quotation. Converting twice returns the invoice already created.
 */
export async function convertQuotationToInvoice(user: AuthenticatedUser, id: string, actor: AuditActor) {
  const profile = await getBusinessProfile();
  const out = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'quotations', id);
    const q = await tx.quotation.findUniqueOrThrow({ where: { id }, include: { items: ITEM_ORDER } });
    if (q.status !== 'ACCEPTED') throw conflict('Only an accepted quotation can be converted to an invoice');
    const existing = await tx.invoice.findFirst({ where: { quotationId: id, status: { not: 'CANCELLED' } }, include: { items: ITEM_ORDER } });
    if (existing) return { invoice: existing, created: false };

    const today = todayYmd();
    const invoice = await tx.invoice.create({
      data: {
        quotationId: q.id,
        status: 'DRAFT',
        clientId: q.clientId,
        customerName: q.customerName,
        customerPhone: q.customerPhone,
        customerEmail: q.customerEmail,
        customerAddress: q.customerAddress,
        customerGstin: q.customerGstin,
        customerState: q.customerState,
        invoiceDate: ymdToDate(today),
        dueDate: ymdToDate(addDays(today, profile.invoiceDueDays)),
        taxMode: q.taxMode,
        subtotal: q.subtotal,
        discountType: q.discountType,
        discountValue: q.discountValue,
        discountAmount: q.discountAmount,
        shippingCharge: q.shippingCharge,
        otherCharges: q.otherCharges,
        chargesTaxRate: q.chargesTaxRate,
        taxableAmount: q.taxableAmount,
        cgstAmount: q.cgstAmount,
        sgstAmount: q.sgstAmount,
        igstAmount: q.igstAmount,
        taxAmount: q.taxAmount,
        roundOff: q.roundOff,
        grandTotal: q.grandTotal,
        paymentTerms: q.paymentTerms,
        notes: q.notes,
        terms: profile.invoiceTerms ?? q.terms,
        createdById: user.id,
        items: { create: q.items.map(({ id: _i, quotationId: _q, ...item }) => item) },
      },
      include: { items: ITEM_ORDER },
    });
    return { invoice, created: true };
  });
  if (out.created) {
    await logAuditEvent({ actor, action: 'CONVERT_QUOTATION', module: 'QUOTATION', recordId: id, newValue: { invoiceId: out.invoice.id } });
    await logAuditEvent({ actor, action: 'CREATE_INVOICE', module: 'INVOICE', recordId: out.invoice.id, newValue: { fromQuotationId: id, grandTotal: Number(out.invoice.grandTotal) } });
  }
  return { ...plain(out), invoice: plain(out.invoice) };
}

export type { QuotationInput };
