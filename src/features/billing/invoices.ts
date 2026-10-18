import { prisma, Prisma, type InvoiceStatus } from '@/lib/db';
import { badRequest, conflict, notFound } from '@/lib/http/errors';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import type { AuthenticatedUser } from '@/lib/permissions';
import { takeNextNumber } from './sequences';
import { getBusinessProfile, snapshotBusiness } from './business';
import { invoiceInputSchema, reasonSchema, recordPaymentSchema } from './schemas';
import { addDays, computeDocument, dateToYmd, draftFromStored, resolveCustomer, todayYmd, ymdToDate } from './documents';
import { lockDocument, plain } from './lock';
import { paiseToRupees, rupeesToPaise } from '@/lib/domain/documentCalc';

const ITEM_ORDER = { orderBy: { position: 'asc' as const } };
const OPEN_STATUSES: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID'];

export const outstandingOf = (inv: { grandTotal: unknown; amountPaid: unknown }) => paiseToRupees(Math.max(0, rupeesToPaise(Number(inv.grandTotal)) - rupeesToPaise(Number(inv.amountPaid))));

/** OVERDUE is derived, never stored: an open invoice whose due date has passed. */
export function invoiceDisplayStatus(inv: { status: InvoiceStatus; dueDate: Date | string }, today = todayYmd()): InvoiceStatus | 'OVERDUE' {
  const due = typeof inv.dueDate === 'string' ? inv.dueDate.slice(0, 10) : dateToYmd(inv.dueDate);
  return OPEN_STATUSES.includes(inv.status) && due < today ? 'OVERDUE' : inv.status;
}

const withDerived = <T extends { status: InvoiceStatus; dueDate: Date; grandTotal: unknown; amountPaid: unknown }>(inv: T) => ({
  ...inv,
  displayStatus: invoiceDisplayStatus(inv),
  outstanding: outstandingOf(inv),
});

const auditSummary = (i: { number: string | null; status: string; grandTotal: unknown; amountPaid?: unknown; customerName: string }) => ({
  number: i.number,
  status: i.status,
  grandTotal: Number(i.grandTotal),
  ...(i.amountPaid !== undefined ? { amountPaid: Number(i.amountPaid) } : {}),
  customer: i.customerName,
});

async function datesFor(input: { invoiceDate?: string; dueDate?: string }, fallback?: { invoiceDate: Date; dueDate: Date }) {
  const profile = await getBusinessProfile();
  const invoiceDate = input.invoiceDate ?? (fallback ? dateToYmd(fallback.invoiceDate) : todayYmd());
  const dueDate = input.dueDate ?? (fallback ? dateToYmd(fallback.dueDate) : addDays(invoiceDate, profile.invoiceDueDays));
  if (dueDate < invoiceDate) throw badRequest('Due date cannot be before the invoice date');
  return { profile, invoiceDate, dueDate };
}

export async function createInvoice(user: AuthenticatedUser, rawInput: unknown, actor: AuditActor) {
  const input = invoiceInputSchema.parse(rawInput);
  const { profile, invoiceDate, dueDate } = await datesFor(input);
  const customer = await resolveCustomer(user, input);
  const computed = computeDocument(input, profile, customer.customerState);
  const created = await prisma.invoice.create({
    data: {
      status: 'DRAFT',
      ...customer,
      invoiceDate: ymdToDate(invoiceDate),
      dueDate: ymdToDate(dueDate),
      ...computed.header,
      paymentTerms: input.paymentTerms ?? profile.defaultPaymentTerms ?? null,
      notes: input.notes ?? profile.invoiceNotes ?? null,
      terms: input.terms ?? profile.invoiceTerms ?? null,
      createdById: user.id,
      items: { create: computed.items },
    },
    include: { items: ITEM_ORDER },
  });
  await logAuditEvent({ actor, action: 'CREATE_INVOICE', module: 'INVOICE', recordId: created.id, newValue: auditSummary(created) });
  return plain(withDerived(created));
}

export async function updateInvoice(user: AuthenticatedUser, id: string, rawInput: unknown, actor: AuditActor) {
  const input = invoiceInputSchema.parse(rawInput);
  const customer = await resolveCustomer(user, input);
  const result = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'invoices', id);
    const current = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (current.status !== 'DRAFT') {
      throw conflict('An issued invoice cannot be edited. Cancel it or create a corrected copy to change it.');
    }
    const { profile, invoiceDate, dueDate } = await datesFor(input, current);
    const computed = computeDocument(input, profile, customer.customerState);
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        ...customer,
        invoiceDate: ymdToDate(invoiceDate),
        dueDate: ymdToDate(dueDate),
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
  await logAuditEvent({ actor, action: 'UPDATE_INVOICE', module: 'INVOICE', recordId: id, oldValue: auditSummary(result.current), newValue: auditSummary(result.updated) });
  return plain(withDerived(result.updated));
}

export async function deleteInvoice(id: string, actor: AuditActor) {
  const removed = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'invoices', id);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== 'DRAFT') throw conflict('Only draft invoices can be deleted. Cancel an issued invoice instead.');
    await tx.invoice.delete({ where: { id } });
    return inv;
  });
  await logAuditEvent({ actor, action: 'DELETE_INVOICE', module: 'INVOICE', recordId: id, oldValue: auditSummary(removed) });
}

/** DRAFT → ISSUED. Totals are recomputed from the saved lines one last time, the number is assigned and the business details are frozen. */
export async function issueInvoice(user: AuthenticatedUser, id: string, actor: AuditActor) {
  const profile = await getBusinessProfile();
  const issued = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'invoices', id);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: ITEM_ORDER } });
    if (inv.status !== 'DRAFT') throw conflict(`Invoice is already ${inv.status.toLowerCase()}`);
    if (!inv.items.length) throw badRequest('Add at least one item before issuing');
    if (inv.taxMode !== 'NONE' && !profile.gstin) {
      throw badRequest('Enter the business GSTIN in Settings → Business details before issuing a GST invoice, or switch this invoice to non-GST.');
    }
    if (!profile.displayName) throw badRequest('Business name is missing in Settings');

    const draft = draftFromStored(inv as any);
    const computed = computeDocument({ ...draft, taxMode: inv.taxMode }, { ...profile, gstEnabled: inv.taxMode !== 'NONE' }, inv.customerState);
    const number = await takeNextNumber(tx, 'INVOICE', inv.invoiceDate);
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    const grand = computed.header.grandTotal;
    return tx.invoice.update({
      where: { id },
      data: {
        ...computed.header,
        number,
        status: grand === 0 ? 'PAID' : 'ISSUED',
        issuedAt: new Date(),
        issuedById: user.id,
        businessSnapshot: (await snapshotBusiness(tx)) as unknown as Prisma.InputJsonValue,
        items: { create: computed.items },
      },
      include: { items: ITEM_ORDER },
    });
  });
  await logAuditEvent({ actor, action: 'ISSUE_INVOICE', module: 'INVOICE', recordId: id, oldValue: { status: 'DRAFT' }, newValue: auditSummary(issued) });
  return plain(withDerived(issued));
}

export async function recordPayment(user: AuthenticatedUser, invoiceId: string, rawInput: unknown, actor: AuditActor) {
  const input = recordPaymentSchema.parse(rawInput);
  const today = todayYmd();
  const paidOn = input.paidOn ?? today;
  if (paidOn > today) throw badRequest('Payment date cannot be in the future');

  const out = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'invoices', invoiceId);

    // Same key again (double click, retry, flaky network): hand back the payment already recorded.
    const duplicate = await tx.invoicePayment.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
    if (duplicate) {
      if (duplicate.invoiceId !== invoiceId) throw conflict('This payment key was already used for another invoice');
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      return { payment: duplicate, invoice: inv, duplicate: true };
    }

    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (!OPEN_STATUSES.includes(inv.status)) {
      throw conflict(inv.status === 'PAID' ? 'This invoice is already fully paid' : inv.status === 'DRAFT' ? 'Issue the invoice before recording a payment' : 'A cancelled invoice cannot receive payments');
    }
    const outstandingP = rupeesToPaise(Number(inv.grandTotal)) - rupeesToPaise(Number(inv.amountPaid));
    const amountP = rupeesToPaise(input.amount);
    if (amountP > outstandingP) throw badRequest(`Amount exceeds the outstanding balance of ${paiseToRupees(outstandingP).toFixed(2)}`);

    const receiptNumber = await takeNextNumber(tx, 'RECEIPT');
    const payment = await tx.invoicePayment.create({
      data: {
        invoiceId,
        receiptNumber,
        amount: paiseToRupees(amountP),
        paidOn: ymdToDate(paidOn),
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey,
        createdById: user.id,
      },
    });
    const paidP = rupeesToPaise(Number(inv.amountPaid)) + amountP;
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { amountPaid: paiseToRupees(paidP), status: paidP >= rupeesToPaise(Number(inv.grandTotal)) ? 'PAID' : 'PARTIALLY_PAID' },
    });
    return { payment, invoice: updated, before: inv, duplicate: false };
  });

  if (!out.duplicate) {
    await logAuditEvent({
      actor,
      action: 'RECORD_INVOICE_PAYMENT',
      module: 'INVOICE_PAYMENT',
      recordId: out.payment.id,
      oldValue: { invoiceId, status: out.before!.status, amountPaid: Number(out.before!.amountPaid) },
      newValue: { receiptNumber: out.payment.receiptNumber, amount: Number(out.payment.amount), method: out.payment.method, invoiceStatus: out.invoice.status, amountPaid: Number(out.invoice.amountPaid) },
    });
    await logAuditEvent({ actor, action: 'PAYMENT_RECORDED', module: 'INVOICE', recordId: invoiceId, newValue: { receiptNumber: out.payment.receiptNumber, amount: Number(out.payment.amount), status: out.invoice.status } });
  }
  return { payment: plain(out.payment), invoice: plain(withDerived(out.invoice)), duplicate: out.duplicate };
}

export async function voidPayment(invoiceId: string, paymentId: string, rawInput: unknown, user: AuthenticatedUser, actor: AuditActor) {
  const { reason } = reasonSchema.parse(rawInput);
  const out = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'invoices', invoiceId);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const payment = await tx.invoicePayment.findFirst({ where: { id: paymentId, invoiceId } });
    if (!payment) throw notFound('Payment not found on this invoice');
    if (payment.status === 'VOIDED') throw conflict('This payment is already voided');
    if (inv.status === 'CANCELLED' || inv.status === 'DRAFT') throw conflict('Payments of a cancelled or draft invoice cannot be changed');

    const paidP = rupeesToPaise(Number(inv.amountPaid)) - rupeesToPaise(Number(payment.amount));
    await tx.invoicePayment.update({ where: { id: paymentId }, data: { status: 'VOIDED', voidedAt: new Date(), voidedById: user.id, voidReason: reason } });
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { amountPaid: paiseToRupees(Math.max(0, paidP)), status: paidP <= 0 ? 'ISSUED' : paidP >= rupeesToPaise(Number(inv.grandTotal)) ? 'PAID' : 'PARTIALLY_PAID' },
    });
    return { before: inv, payment, updated };
  });
  await logAuditEvent({
    actor,
    action: 'VOID_INVOICE_PAYMENT',
    module: 'INVOICE_PAYMENT',
    recordId: paymentId,
    oldValue: { status: 'RECORDED', amount: Number(out.payment.amount), invoiceStatus: out.before.status },
    newValue: { status: 'VOIDED', reason, invoiceStatus: out.updated.status, amountPaid: Number(out.updated.amountPaid) },
  });
  await logAuditEvent({ actor, action: 'PAYMENT_VOIDED', module: 'INVOICE', recordId: invoiceId, newValue: { receiptNumber: out.payment.receiptNumber, reason, status: out.updated.status } });
  return plain(withDerived(out.updated));
}

export async function cancelInvoice(user: AuthenticatedUser, id: string, rawInput: unknown, actor: AuditActor) {
  const { reason } = reasonSchema.parse(rawInput);
  const cancelled = await prisma.$transaction(async (tx) => cancelLocked(tx, id, reason, user));
  await logAuditEvent({ actor, action: 'CANCEL_INVOICE', module: 'INVOICE', recordId: id, oldValue: { status: cancelled.before.status }, newValue: { status: 'CANCELLED', reason } });
  return plain(withDerived(cancelled.updated));
}

async function cancelLocked(tx: Prisma.TransactionClient | any, id: string, reason: string, user: AuthenticatedUser) {
  await lockDocument(tx, 'invoices', id);
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.status === 'CANCELLED') throw conflict('Invoice is already cancelled');
  if (inv.status === 'DRAFT') throw conflict('A draft invoice can simply be deleted');
  if (Number(inv.amountPaid) > 0 || inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID') {
    throw conflict('This invoice has recorded payments. Void them (with a reason) before cancelling the invoice.');
  }
  const updated = await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason }, include: { items: ITEM_ORDER } });
  return { before: inv, updated };
}

/**
 * Correction workflow for an issued invoice: the original is cancelled (it keeps its number and
 * figures) and a new draft copy, linked to it, is opened for editing. Calling it again returns the
 * copy already open.
 */
export async function correctInvoice(user: AuthenticatedUser, id: string, rawInput: unknown, actor: AuditActor) {
  const { reason } = reasonSchema.parse(rawInput);
  const profile = await getBusinessProfile();
  const out = await prisma.$transaction(async (tx) => {
    await lockDocument(tx, 'invoices', id);
    const existing = await tx.invoice.findFirst({ where: { correctsInvoiceId: id, status: { not: 'CANCELLED' } }, include: { items: ITEM_ORDER } });
    if (existing) return { copy: existing, created: false, original: null as any };

    const src = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: ITEM_ORDER } });
    if (src.status === 'DRAFT') throw conflict('A draft invoice can be edited directly');
    let original = src;
    if (src.status !== 'CANCELLED') {
      const c = await cancelLocked(tx, id, `Corrected: ${reason}`, user);
      original = { ...c.updated, items: src.items };
    }
    const today = todayYmd();
    const { id: _id, createdAt: _c, updatedAt: _u, items, number: _n, ...rest } = src;
    const copy = await tx.invoice.create({
      data: {
        ...rest,
        status: 'DRAFT',
        correctsInvoiceId: id,
        invoiceDate: ymdToDate(today),
        dueDate: ymdToDate(addDays(today, profile.invoiceDueDays)),
        amountPaid: 0,
        businessSnapshot: Prisma.DbNull,
        issuedAt: null,
        issuedById: null,
        cancelledAt: null,
        cancelledById: null,
        cancelReason: null,
        createdById: user.id,
        items: { create: items.map(({ id: _i, invoiceId: _v, ...item }) => item) },
      },
      include: { items: ITEM_ORDER },
    });
    return { copy, created: true, original };
  });
  if (out.created) {
    await logAuditEvent({ actor, action: 'CORRECT_INVOICE', module: 'INVOICE', recordId: id, oldValue: { number: out.original.number, status: out.original.status }, newValue: { reason, correctedCopyId: out.copy.id } });
    await logAuditEvent({ actor, action: 'CREATE_INVOICE', module: 'INVOICE', recordId: out.copy.id, newValue: { correctsInvoiceId: id, correctsNumber: out.original.number } });
  }
  return { copy: plain(withDerived(out.copy)), created: out.created };
}

export interface InvoiceListQuery {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  clientId?: string;
  quotationId?: string;
  sort?: string;
  dir?: string;
  limit: number;
  offset: number;
}

const SORTS: Record<string, string> = { date: 'invoiceDate', number: 'number', total: 'grandTotal', customer: 'customerName', due: 'dueDate', created: 'createdAt' };

export function invoiceWhere(query: Pick<InvoiceListQuery, 'q' | 'status' | 'from' | 'to' | 'clientId' | 'quotationId'>): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {};
  if (query.status === 'OVERDUE') {
    where.status = { in: OPEN_STATUSES };
    where.dueDate = { lt: ymdToDate(todayYmd()) };
  } else if (query.status) where.status = query.status as InvoiceStatus;
  if (query.clientId) where.clientId = query.clientId;
  if (query.quotationId) where.quotationId = query.quotationId;
  if (query.from || query.to) where.invoiceDate = { ...(query.from ? { gte: ymdToDate(query.from) } : {}), ...(query.to ? { lte: ymdToDate(query.to) } : {}) };
  if (query.q) {
    where.OR = [
      { number: { contains: query.q, mode: 'insensitive' } },
      { customerName: { contains: query.q, mode: 'insensitive' } },
      { customerPhone: { contains: query.q } },
    ];
  }
  return where;
}

export async function listInvoices(query: InvoiceListQuery) {
  const where = invoiceWhere(query);
  const sortField = SORTS[query.sort ?? ''] ?? 'createdAt';
  const [rows, total, sums] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: [{ [sortField]: query.dir === 'asc' ? 'asc' : 'desc' }, { createdAt: 'desc' }], take: query.limit, skip: query.offset }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { AND: [where, { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } }] }, _sum: { grandTotal: true, amountPaid: true } }),
  ]);
  const billed = Number(sums._sum.grandTotal ?? 0);
  const collected = Number(sums._sum.amountPaid ?? 0);
  return {
    data: plain(rows.map(withDerived)),
    total,
    summary: { billed, collected, outstanding: paiseToRupees(rupeesToPaise(billed) - rupeesToPaise(collected)) },
  };
}

export async function getInvoice(id: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: ITEM_ORDER,
      payments: { orderBy: { createdAt: 'asc' } },
      quotation: { select: { id: true, number: true, revision: true } },
    },
  });
  if (!inv) throw notFound('Invoice not found');
  const [corrects, correctedBy] = await Promise.all([
    inv.correctsInvoiceId ? prisma.invoice.findUnique({ where: { id: inv.correctsInvoiceId }, select: { id: true, number: true, status: true } }) : null,
    prisma.invoice.findMany({ where: { correctsInvoiceId: id }, select: { id: true, number: true, status: true } }),
  ]);
  const history = await prisma.auditLog.findMany({
    where: { OR: [{ module: 'INVOICE', recordId: id }, { module: 'INVOICE_PAYMENT', recordId: { in: inv.payments.map((p) => p.id) } }] },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, action: true, module: true, oldValue: true, newValue: true, createdAt: true, user: { select: { name: true } } },
  });
  return plain({ ...withDerived(inv), corrects, correctedBy, history });
}
