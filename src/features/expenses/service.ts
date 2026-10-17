import { prisma, Prisma, ExpenseStatus, ExpenseCategory, Role } from '@/lib/db';
import {
  createExpenseSchema,
  updateExpenseSchema,
  approveExpenseSchema,
  rejectExpenseSchema,
  reimburseExpenseSchema,
} from '@/lib/validations/schemas';
import { badRequest, forbidden, notFound } from '@/lib/http/errors';
import { canAccessSalesperson, type AuthenticatedUser } from '@/lib/permissions';
import { nextDocumentNumber, withUniqueRetry, isUniqueViolation } from '@/lib/services/numbering';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import { createNotification } from '@/lib/services/notifications';
import { notifyExpenseEvent } from '@/lib/realtime/emitter';
import type { StoredResponse } from '@/lib/services/idempotency';

const num = (d: Prisma.Decimal | number) => parseFloat(d.toString());
const withAmount = <T extends { amount: Prisma.Decimal }>(e: T) => JSON.parse(JSON.stringify({ ...e, amount: num(e.amount) }));

/** Legacy routes used safeParse and returned only the first issue's message. */
function parseOr400<T>(schema: { safeParse: (v: unknown) => any }, raw: unknown, fallback: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.errors[0]?.message || fallback);
  return parsed.data as T;
}

export function formatExpense(e: any) {
  return {
    id: e.id,
    expenseNumber: e.expenseNumber,
    salespersonId: e.salespersonId,
    salespersonName: e.salesperson?.user?.name,
    salespersonCode: e.salesperson?.employeeCode,
    category: e.category,
    amount: num(e.amount),
    currency: e.currency,
    expenseDate: e.expenseDate.toISOString(),
    description: e.description,
    businessPurpose: e.businessPurpose,
    merchantName: e.merchantName,
    paymentMethod: e.paymentMethod,
    receiptUrl: e.receiptUrl,
    clientId: e.clientId,
    clientName: e.client ? e.client.businessName || e.client.name : null,
    visitId: e.visitId,
    attendanceId: e.attendanceId,
    latitude: e.latitude,
    longitude: e.longitude,
    status: e.status,
    rejectionReason: e.rejectionReason,
    submittedAt: e.submittedAt?.toISOString() || null,
    approvedAt: e.approvedAt?.toISOString() || null,
    approvedByName: e.approver?.name || null,
    rejectedAt: e.rejectedAt?.toISOString() || null,
    rejectedByName: e.rejecter?.name || null,
    reimbursedAt: e.reimbursedAt?.toISOString() || null,
    reimbursedByName: e.reimburser?.name || null,
    reimbursementRef: e.reimbursementRef,
    reimbursementMethod: e.reimbursementMethod,
    offlineId: e.offlineId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** Salesperson filter for expense listing (legacy semantics: manager filter outside team → 403). */
export function expenseScope(user: AuthenticatedUser, requestedSalespersonId?: string | null): Prisma.ExpenseWhereInput {
  if (user.role === Role.SALESPERSON) {
    if (!user.salespersonId) throw forbidden('No salesperson profile linked to this account.');
    return { salespersonId: user.salespersonId };
  }
  if (user.role === Role.MANAGER) {
    const team = user.managedSalespersonIds || [];
    if (requestedSalespersonId) {
      if (!team.includes(requestedSalespersonId)) throw forbidden('Unauthorized to view expenses for this salesperson.');
      return { salespersonId: requestedSalespersonId };
    }
    return { salespersonId: { in: team } };
  }
  return requestedSalespersonId ? { salespersonId: requestedSalespersonId } : {};
}

export async function getExpenseForUser(user: AuthenticatedUser, id: string) {
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      salesperson: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
      client: true,
      visit: true,
      attendance: true,
      approver: { select: { id: true, name: true, email: true } },
      rejecter: { select: { id: true, name: true, email: true } },
      reimburser: { select: { id: true, name: true, email: true } },
      history: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!expense) throw notFound('Expense claim not found');
  if (!canAccessSalesperson(user, expense.salespersonId)) throw forbidden('Unauthorized to view this expense claim');
  return withAmount(expense);
}

export async function createExpense(
  user: AuthenticatedUser,
  rawInput: unknown,
  actor: AuditActor,
  opts: { historyAction?: { submitted: string; draft: string; comment: string } } = {}
): Promise<StoredResponse> {
  const data = parseOr400<any>(createExpenseSchema, rawInput, 'Invalid expense data');
  if (!user.salespersonId) throw forbidden('Only field sales representatives can create expense claims.');
  const salespersonId = user.salespersonId;

  // Linked records must belong to the claimant / be accessible (legacy trusted any ID).
  if (data.visitId) {
    const v = await prisma.clientVisit.findUnique({ where: { id: data.visitId }, select: { salespersonId: true } });
    if (!v || v.salespersonId !== salespersonId) throw badRequest('Linked visit not found');
  }
  if (data.attendanceId) {
    const a = await prisma.attendance.findUnique({ where: { id: data.attendanceId }, select: { salespersonId: true } });
    if (!a || a.salespersonId !== salespersonId) throw badRequest('Linked attendance not found');
  }

  if (data.offlineId) {
    const existing = await prisma.expense.findFirst({ where: { offlineId: data.offlineId }, include: { salesperson: { include: { user: true } } } });
    if (existing) {
      if (existing.salespersonId !== salespersonId) throw forbidden('Offline reference belongs to another user');
      return { status: 200, body: { message: 'Expense already synchronized', data: withAmount(existing) } };
    }
  }

  const isSubmitted = data.status === 'SUBMITTED';
  const labels = opts.historyAction ?? {
    submitted: 'SUBMITTED',
    draft: 'CREATED_DRAFT',
    comment: isSubmitted ? 'Claim submitted for manager review' : 'Draft claim created',
  };

  let result;
  try {
    result = await withUniqueRetry(() =>
      prisma.$transaction(async (tx) => {
        const expenseNumber = await nextDocumentNumber(tx, 'expense');
        const created = await tx.expense.create({
          data: {
            expenseNumber,
            salespersonId,
            category: data.category as ExpenseCategory,
            amount: new Prisma.Decimal(Number(data.amount).toFixed(2)),
            expenseDate: new Date(data.expenseDate),
            description: data.description,
            businessPurpose: data.businessPurpose,
            merchantName: data.merchantName,
            paymentMethod: data.paymentMethod || 'CASH',
            receiptUrl: data.receiptUrl,
            clientId: data.clientId,
            visitId: data.visitId,
            attendanceId: data.attendanceId,
            latitude: data.latitude,
            longitude: data.longitude,
            status: isSubmitted ? ExpenseStatus.SUBMITTED : ExpenseStatus.DRAFT,
            submittedAt: isSubmitted ? new Date() : null,
            offlineId: data.offlineId,
          },
          include: { salesperson: { include: { user: true } }, client: true },
        });
        await tx.expenseHistory.create({
          data: {
            expenseId: created.id,
            actorId: user.id,
            action: isSubmitted ? labels.submitted : labels.draft,
            newStatus: created.status,
            comment: labels.comment,
            snapshot: { amount: data.amount, category: data.category, expenseDate: data.expenseDate, description: data.description },
          },
        });
        return created;
      })
    );
  } catch (err) {
    if (isUniqueViolation(err) && data.offlineId) {
      const existing = await prisma.expense.findFirst({ where: { offlineId: data.offlineId } });
      if (existing) return { status: 200, body: { message: 'Expense already synchronized', data: withAmount(existing) } };
    }
    throw err;
  }

  await logAuditEvent({
    actor,
    action: isSubmitted ? 'SUBMIT_EXPENSE' : 'CREATE_EXPENSE_DRAFT',
    module: 'EXPENSES',
    recordId: result.id,
    newValue: { expenseNumber: result.expenseNumber, amount: data.amount, category: data.category, status: result.status },
  });
  if (isSubmitted) notifyExpenseEvent('EXPENSE_SUBMITTED', withAmount(result));

  return {
    status: 201,
    body: { message: isSubmitted ? 'Expense claim submitted for approval' : 'Draft expense saved', data: withAmount(result) },
  };
}

async function loadOwnEditable(user: AuthenticatedUser, id: string, verb: 'edit' | 'submit') {
  const expense = await prisma.expense.findUnique({ where: { id }, include: { salesperson: true } });
  if (!expense) throw notFound('Expense claim not found');
  if (expense.salespersonId !== user.salespersonId) {
    throw forbidden(verb === 'edit' ? 'You can only edit your own expense claims.' : 'Unauthorized to submit this expense claim.');
  }
  if (expense.status !== ExpenseStatus.DRAFT && expense.status !== ExpenseStatus.REJECTED) {
    throw badRequest(
      verb === 'edit'
        ? `Cannot edit an expense in ${expense.status} status. Approved or submitted records are locked.`
        : `Cannot submit claim currently in ${expense.status} status.`
    );
  }
  return expense;
}

export async function updateExpense(user: AuthenticatedUser, id: string, rawInput: unknown): Promise<StoredResponse> {
  const data = parseOr400<any>(updateExpenseSchema, rawInput, 'Invalid expense update data');
  const expense = await loadOwnEditable(user, id, 'edit');

  const update: Prisma.ExpenseUpdateInput = {};
  if (data.category) update.category = data.category as ExpenseCategory;
  if (data.amount) update.amount = new Prisma.Decimal(Number(data.amount).toFixed(2));
  if (data.expenseDate) update.expenseDate = new Date(data.expenseDate);
  if (data.description) update.description = data.description;
  if (data.businessPurpose !== undefined) update.businessPurpose = data.businessPurpose;
  if (data.merchantName !== undefined) update.merchantName = data.merchantName;
  if (data.paymentMethod !== undefined) update.paymentMethod = data.paymentMethod;
  if (data.receiptUrl !== undefined) update.receiptUrl = data.receiptUrl;

  const updated = await prisma.$transaction(async (tx) => {
    const rec = await tx.expense.update({ where: { id: expense.id }, data: update, include: { salesperson: { include: { user: true } } } });
    await tx.expenseHistory.create({
      data: {
        expenseId: rec.id,
        actorId: user.id,
        action: 'REVISED',
        previousStatus: expense.status,
        newStatus: rec.status,
        comment: 'Claim details updated by staff',
        snapshot: JSON.parse(JSON.stringify(update)),
      },
    });
    return rec;
  });
  return { status: 200, body: { message: 'Expense claim updated successfully', data: withAmount(updated) } };
}

export async function submitExpense(user: AuthenticatedUser, id: string, comment?: string): Promise<StoredResponse> {
  const expense = await loadOwnEditable(user, id, 'submit');
  const updated = await prisma.$transaction(async (tx) => {
    // Conditional update guards against a double submit racing a manager review.
    const res = await tx.expense.updateMany({
      where: { id: expense.id, status: expense.status },
      data: { status: ExpenseStatus.SUBMITTED, submittedAt: new Date(), rejectionReason: null },
    });
    if (res.count === 0) throw badRequest('Expense claim was modified concurrently; please refresh.');
    await tx.expenseHistory.create({
      data: {
        expenseId: expense.id,
        actorId: user.id,
        action: expense.status === ExpenseStatus.REJECTED ? 'RESUBMITTED' : 'SUBMITTED',
        previousStatus: expense.status,
        newStatus: ExpenseStatus.SUBMITTED,
        comment: comment || (expense.status === ExpenseStatus.REJECTED ? 'Resubmitted after addressing rejection' : 'Submitted for approval'),
      },
    });
    return tx.expense.findUniqueOrThrow({ where: { id: expense.id }, include: { salesperson: { include: { user: true } } } });
  });
  notifyExpenseEvent('EXPENSE_SUBMITTED', withAmount(updated));
  return { status: 200, body: { message: 'Expense claim submitted successfully', data: withAmount(updated) } };
}

async function loadForReview(user: AuthenticatedUser, id: string, outsideTeamMessage: string) {
  const expense = await prisma.expense.findUnique({ where: { id }, include: { salesperson: { include: { user: true } } } });
  if (!expense) throw notFound('Expense claim not found');
  if (user.role === Role.MANAGER && !(user.managedSalespersonIds || []).includes(expense.salespersonId)) {
    throw forbidden(outsideTeamMessage);
  }
  return expense;
}

/** Moves SUBMITTED/APPROVED → next status only if still in the expected status (no double review). */
async function transition(
  expenseId: string,
  from: ExpenseStatus,
  data: Prisma.ExpenseUncheckedUpdateManyInput,
  history: { actorId: string; action: string; newStatus: ExpenseStatus; comment: string },
  include: Prisma.ExpenseInclude
) {
  return prisma.$transaction(async (tx) => {
    const res = await tx.expense.updateMany({ where: { id: expenseId, status: from }, data });
    if (res.count === 0) throw badRequest('Expense claim was already reviewed; please refresh.');
    await tx.expenseHistory.create({ data: { expenseId, previousStatus: from, ...history } });
    return tx.expense.findUniqueOrThrow({ where: { id: expenseId }, include });
  });
}

export async function approveExpense(user: AuthenticatedUser, id: string, rawInput: unknown, actor: AuditActor): Promise<StoredResponse> {
  const parsed = approveExpenseSchema.safeParse(rawInput);
  const comment = parsed.success ? parsed.data.comment : undefined;
  const expense = await prisma.expense.findUnique({ where: { id }, include: { salesperson: { include: { user: true } } } });
  if (!expense) throw notFound('Expense claim not found');
  if (expense.salesperson.userId === user.id) {
    throw badRequest('Self-approval is strictly prohibited. An independent manager or administrator must review this claim.');
  }
  await loadForReview(user, id, 'Unauthorized to approve expenses for salespersons outside your team.');
  if (expense.status !== ExpenseStatus.SUBMITTED) {
    throw badRequest(`Cannot approve an expense with status: ${expense.status}. Only SUBMITTED claims can be approved.`);
  }

  const updated = await transition(
    id,
    ExpenseStatus.SUBMITTED,
    { status: ExpenseStatus.APPROVED, approvedAt: new Date(), approvedBy: user.id },
    { actorId: user.id, action: 'APPROVED', newStatus: ExpenseStatus.APPROVED, comment: comment || 'Claim verified and approved for reimbursement' },
    { salesperson: { include: { user: true } }, approver: { select: { id: true, name: true } } }
  );
  await logAuditEvent({ actor, action: 'APPROVE_EXPENSE', module: 'EXPENSES', recordId: id, newValue: { status: ExpenseStatus.APPROVED, amount: num(updated.amount) } });
  await createNotification({
    recipientId: expense.salesperson.userId,
    role: Role.SALESPERSON,
    title: 'Expense Approved',
    message: `Expense ${expense.expenseNumber} for ₹${num(expense.amount)} was approved.`,
    type: 'EXPENSE_UPDATE',
  });
  notifyExpenseEvent('EXPENSE_APPROVED', withAmount(updated));
  return { status: 200, body: { message: 'Expense claim approved successfully', data: withAmount(updated) } };
}

export async function rejectExpense(user: AuthenticatedUser, id: string, rawInput: unknown, actor: AuditActor): Promise<StoredResponse> {
  // Authorize before validating, so out-of-scope callers learn nothing about the claim.
  const expense = await loadForReview(user, id, 'Unauthorized to review expenses for salespersons outside your team.');
  const { rejectionReason } = parseOr400<{ rejectionReason: string }>(rejectExpenseSchema, rawInput, 'A clear rejection reason is required.');
  if (expense.status !== ExpenseStatus.SUBMITTED) {
    throw badRequest(`Cannot reject an expense with status: ${expense.status}. Only SUBMITTED claims can be rejected.`);
  }
  const updated = await transition(
    id,
    ExpenseStatus.SUBMITTED,
    { status: ExpenseStatus.REJECTED, rejectedAt: new Date(), rejectedBy: user.id, rejectionReason },
    { actorId: user.id, action: 'REJECTED', newStatus: ExpenseStatus.REJECTED, comment: rejectionReason },
    { salesperson: { include: { user: true } }, rejecter: { select: { id: true, name: true } } }
  );
  await logAuditEvent({ actor, action: 'REJECT_EXPENSE', module: 'EXPENSES', recordId: id, newValue: { status: ExpenseStatus.REJECTED, rejectionReason } });
  await createNotification({
    recipientId: expense.salesperson.userId,
    role: Role.SALESPERSON,
    title: 'Expense Rejected',
    message: `Expense ${expense.expenseNumber} was rejected: ${rejectionReason}`,
    type: 'EXPENSE_UPDATE',
  });
  notifyExpenseEvent('EXPENSE_REJECTED', withAmount(updated));
  return { status: 200, body: { message: 'Expense claim rejected', data: withAmount(updated) } };
}

export async function reimburseExpense(user: AuthenticatedUser, id: string, rawInput: unknown, actor: AuditActor): Promise<StoredResponse> {
  const expense = await loadForReview(user, id, 'Unauthorized to reimburse expenses for salespersons outside your team.');
  const { reimbursementRef, reimbursementMethod, comment } = parseOr400<{ reimbursementRef: string; reimbursementMethod: string; comment?: string }>(
    reimburseExpenseSchema,
    rawInput,
    'Payment reference and method are required.'
  );
  if (expense.status !== ExpenseStatus.APPROVED) {
    throw badRequest(`Only APPROVED expenses can be marked as reimbursed. Current status is ${expense.status}.`);
  }
  const updated = await transition(
    id,
    ExpenseStatus.APPROVED,
    { status: ExpenseStatus.REIMBURSED, reimbursedAt: new Date(), reimbursedBy: user.id, reimbursementRef, reimbursementMethod },
    {
      actorId: user.id,
      action: 'REIMBURSED',
      newStatus: ExpenseStatus.REIMBURSED,
      comment: comment || `Disbursed via ${reimbursementMethod} (Ref: ${reimbursementRef})`,
    },
    { salesperson: { include: { user: true } }, reimburser: { select: { id: true, name: true } } }
  );
  await logAuditEvent({ actor, action: 'REIMBURSE_EXPENSE', module: 'EXPENSES', recordId: id, newValue: { status: ExpenseStatus.REIMBURSED, reimbursementRef, reimbursementMethod } });
  await createNotification({
    recipientId: expense.salesperson.userId,
    role: Role.SALESPERSON,
    title: 'Expense Reimbursed',
    message: `Expense ${expense.expenseNumber} was reimbursed via ${reimbursementMethod} (Ref: ${reimbursementRef}).`,
    type: 'EXPENSE_UPDATE',
  });
  notifyExpenseEvent('EXPENSE_REIMBURSED', withAmount(updated));
  return { status: 200, body: { message: 'Reimbursement recorded successfully', data: withAmount(updated) } };
}
