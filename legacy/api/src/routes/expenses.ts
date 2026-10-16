import { Router, Request, Response } from 'express';
import { prisma, Role, ExpenseStatus, ExpenseCategory, Prisma } from '../db';
import {
  createExpenseSchema,
  updateExpenseSchema,
  approveExpenseSchema,
  rejectExpenseSchema,
  reimburseExpenseSchema,
} from '../shared';
import { authenticateToken, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';
import {
  notifyExpenseSubmitted,
  notifyExpenseApproved,
  notifyExpenseRejected,
  notifyExpenseReimbursed,
} from '../socket';

const router = Router();

async function generateNextExpenseNumber(): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `EXP-${currentYear}-`;
  const allExpenses = await prisma.expense.findMany({
    where: { expenseNumber: { startsWith: prefix } },
    select: { expenseNumber: true },
  });

  let maxSeq = 0;
  for (const exp of allExpenses) {
    if (exp.expenseNumber) {
      const parts = exp.expenseNumber.split('-');
      if (parts.length === 3) {
        const parsedSeq = parseInt(parts[2], 10);
        if (!isNaN(parsedSeq) && parsedSeq > maxSeq) {
          maxSeq = parsedSeq;
        }
      }
    }
  }

  const nextSequence = maxSeq + 1;
  return `${prefix}${nextSequence.toString().padStart(6, '0')}`;
}

// GET /api/expenses - List expenses (scoped by role, manager team, or salesperson)
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, category, salespersonId, startDate, endDate, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.ExpenseWhereInput = {};

    // Role-based scoping
    if (req.user!.role === Role.SALESPERSON) {
      if (!req.user!.salespersonId) {
        res.status(403).json({ error: 'No salesperson profile linked to this account.' });
        return;
      }
      where.salespersonId = req.user!.salespersonId;
    } else if (req.user!.role === Role.MANAGER) {
      // Find assigned salespersons
      const managed = await prisma.managerSalesperson.findMany({
        where: { managerId: req.user!.id },
        select: { salespersonId: true },
      });
      const managedIds = managed.map((m) => m.salespersonId);

      if (salespersonId) {
        if (!managedIds.includes(salespersonId as string)) {
          res.status(403).json({ error: 'Unauthorized to view expenses for this salesperson.' });
          return;
        }
        where.salespersonId = salespersonId as string;
      } else {
        where.salespersonId = { in: managedIds };
      }
    } else if (req.user!.role === Role.SUPER_ADMIN) {
      if (salespersonId) {
        where.salespersonId = salespersonId as string;
      }
    }

    if (status) {
      where.status = status as ExpenseStatus;
    }

    if (category) {
      where.category = category as ExpenseCategory;
    }

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = new Date(startDate as string);
      if (endDate) where.expenseDate.lte = new Date(endDate as string);
    }

    const [total, expenses] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        include: {
          salesperson: {
            include: {
              user: { select: { name: true, email: true, phone: true } },
            },
          },
          client: { select: { id: true, name: true, businessName: true } },
          approver: { select: { id: true, name: true } },
          rejecter: { select: { id: true, name: true } },
          reimburser: { select: { id: true, name: true } },
        },
        orderBy: { expenseDate: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    // Financial summaries for the filtered set
    const summaryAggregates = await prisma.expense.groupBy({
      by: ['status'],
      where,
      _sum: { amount: true },
      _count: { id: true },
    });

    const statusTotals: Record<string, { count: number; totalAmount: number }> = {
      DRAFT: { count: 0, totalAmount: 0 },
      SUBMITTED: { count: 0, totalAmount: 0 },
      APPROVED: { count: 0, totalAmount: 0 },
      REJECTED: { count: 0, totalAmount: 0 },
      REIMBURSED: { count: 0, totalAmount: 0 },
    };

    summaryAggregates.forEach((agg) => {
      statusTotals[agg.status] = {
        count: agg._count.id,
        totalAmount: agg._sum.amount ? parseFloat(agg._sum.amount.toString()) : 0,
      };
    });

    const formatted = expenses.map((e) => ({
      id: e.id,
      expenseNumber: e.expenseNumber,
      salespersonId: e.salespersonId,
      salespersonName: e.salesperson.user.name,
      salespersonCode: e.salesperson.employeeCode,
      category: e.category,
      amount: parseFloat(e.amount.toString()),
      currency: e.currency,
      expenseDate: e.expenseDate.toISOString(),
      description: e.description,
      businessPurpose: e.businessPurpose,
      merchantName: e.merchantName,
      paymentMethod: e.paymentMethod,
      receiptUrl: e.receiptUrl,
      clientId: e.clientId,
      clientName: e.client ? (e.client.businessName || e.client.name) : null,
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
    }));

    res.json({
      data: formatted,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      summary: statusTotals,
    });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to retrieve expenses' });
  }
});

// GET /api/expenses/:id - Expense detail with full history timeline
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        salesperson: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
        client: true,
        visit: true,
        attendance: true,
        approver: { select: { id: true, name: true, email: true } },
        rejecter: { select: { id: true, name: true, email: true } },
        reimburser: { select: { id: true, name: true, email: true } },
        history: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!expense) {
      res.status(404).json({ error: 'Expense claim not found' });
      return;
    }

    // Role check
    if (req.user!.role === Role.SALESPERSON && expense.salespersonId !== req.user!.salespersonId) {
      res.status(403).json({ error: 'Unauthorized to view this expense claim' });
      return;
    }

    if (req.user!.role === Role.MANAGER) {
      const isAssigned = await prisma.managerSalesperson.findFirst({
        where: {
          managerId: req.user!.id,
          salespersonId: expense.salespersonId,
        },
      });
      if (!isAssigned) {
        res.status(403).json({ error: 'Unauthorized to view this expense claim' });
        return;
      }
    }

    res.json({
      data: {
        ...expense,
        amount: parseFloat(expense.amount.toString()),
      },
    });
  } catch (error) {
    console.error('Error retrieving expense detail:', error);
    res.status(500).json({ error: 'Failed to retrieve expense claim details' });
  }
});

// POST /api/expenses - Create new expense (Draft or Submitted)
router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid expense data' });
      return;
    }

    // Ensure user has salesperson profile
    if (!req.user!.salespersonId) {
      res.status(403).json({ error: 'Only field sales representatives can create expense claims.' });
      return;
    }

    const salespersonId = req.user!.salespersonId;
    const {
      category,
      amount,
      expenseDate,
      description,
      businessPurpose,
      merchantName,
      paymentMethod,
      receiptUrl,
      clientId,
      visitId,
      attendanceId,
      latitude,
      longitude,
      status,
      offlineId,
    } = parsed.data;

    // Deduplication by offlineId if provided
    if (offlineId) {
      const existing = await prisma.expense.findUnique({
        where: { offlineId },
        include: {
          salesperson: { include: { user: true } },
        },
      });
      if (existing) {
        res.status(200).json({
          message: 'Expense already synchronized',
          data: { ...existing, amount: parseFloat(existing.amount.toString()) },
        });
        return;
      }
    }

    const expenseNumber = await generateNextExpenseNumber();
    const isSubmitted = status === 'SUBMITTED';

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          expenseNumber,
          salespersonId,
          category: category as ExpenseCategory,
          amount: new Prisma.Decimal(amount.toFixed(2)),
          expenseDate: new Date(expenseDate),
          description,
          businessPurpose,
          merchantName,
          paymentMethod: paymentMethod || 'CASH',
          receiptUrl,
          clientId,
          visitId,
          attendanceId,
          latitude,
          longitude,
          status: isSubmitted ? ExpenseStatus.SUBMITTED : ExpenseStatus.DRAFT,
          submittedAt: isSubmitted ? new Date() : null,
          offlineId,
        },
        include: {
          salesperson: { include: { user: true } },
          client: true,
        },
      });

      // Record timeline history
      await tx.expenseHistory.create({
        data: {
          expenseId: created.id,
          actorId: req.user!.id,
          action: isSubmitted ? 'SUBMITTED' : 'CREATED_DRAFT',
          newStatus: created.status,
          comment: isSubmitted ? 'Claim submitted for manager review' : 'Draft claim created',
          snapshot: {
            amount,
            category,
            expenseDate,
            description,
          },
        },
      });

      return created;
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: isSubmitted ? 'SUBMIT_EXPENSE' : 'CREATE_EXPENSE_DRAFT',
      module: 'EXPENSES',
      recordId: result.id,
      newValue: {
        expenseNumber: result.expenseNumber,
        amount,
        category,
        status: result.status,
      },
    });

    if (isSubmitted) {
      notifyExpenseSubmitted({
        ...result,
        amount: parseFloat(result.amount.toString()),
      });
    }

    res.status(201).json({
      message: isSubmitted ? 'Expense claim submitted for approval' : 'Draft expense saved',
      data: {
        ...result,
        amount: parseFloat(result.amount.toString()),
      },
    });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense claim' });
  }
});

// PUT /api/expenses/:id - Edit draft or rejected expense
router.put('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = updateExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid expense update data' });
      return;
    }

    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { salesperson: true },
    });

    if (!expense) {
      res.status(404).json({ error: 'Expense claim not found' });
      return;
    }

    // Must be the owner
    if (expense.salespersonId !== req.user!.salespersonId) {
      res.status(403).json({ error: 'You can only edit your own expense claims.' });
      return;
    }

    // Only DRAFT or REJECTED claims can be edited
    if (expense.status !== ExpenseStatus.DRAFT && expense.status !== ExpenseStatus.REJECTED) {
      res.status(400).json({
        error: `Cannot edit an expense in ${expense.status} status. Approved or submitted records are locked.`,
      });
      return;
    }

    const updateData: any = {};
    if (parsed.data.category) updateData.category = parsed.data.category as ExpenseCategory;
    if (parsed.data.amount) updateData.amount = new Prisma.Decimal(parsed.data.amount.toFixed(2));
    if (parsed.data.expenseDate) updateData.expenseDate = new Date(parsed.data.expenseDate);
    if (parsed.data.description) updateData.description = parsed.data.description;
    if (parsed.data.businessPurpose !== undefined) updateData.businessPurpose = parsed.data.businessPurpose;
    if (parsed.data.merchantName !== undefined) updateData.merchantName = parsed.data.merchantName;
    if (parsed.data.paymentMethod !== undefined) updateData.paymentMethod = parsed.data.paymentMethod;
    if (parsed.data.receiptUrl !== undefined) updateData.receiptUrl = parsed.data.receiptUrl;

    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.expense.update({
        where: { id: expense.id },
        data: updateData,
        include: { salesperson: { include: { user: true } } },
      });

      await tx.expenseHistory.create({
        data: {
          expenseId: rec.id,
          actorId: req.user!.id,
          action: 'REVISED',
          previousStatus: expense.status,
          newStatus: rec.status,
          comment: 'Claim details updated by staff',
          snapshot: updateData,
        },
      });

      return rec;
    });

    res.json({
      message: 'Expense claim updated successfully',
      data: { ...updated, amount: parseFloat(updated.amount.toString()) },
    });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense claim' });
  }
});

// POST /api/expenses/:id/submit - Submit draft or resubmit rejected expense
router.post('/:id/submit', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { salesperson: { include: { user: true } } },
    });

    if (!expense) {
      res.status(404).json({ error: 'Expense claim not found' });
      return;
    }

    if (expense.salespersonId !== req.user!.salespersonId) {
      res.status(403).json({ error: 'Unauthorized to submit this expense claim.' });
      return;
    }

    if (expense.status !== ExpenseStatus.DRAFT && expense.status !== ExpenseStatus.REJECTED) {
      res.status(400).json({ error: `Cannot submit claim currently in ${expense.status} status.` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const resExp = await tx.expense.update({
        where: { id: expense.id },
        data: {
          status: ExpenseStatus.SUBMITTED,
          submittedAt: new Date(),
          rejectionReason: null, // Clear past rejection reason on resubmission
        },
        include: { salesperson: { include: { user: true } } },
      });

      await tx.expenseHistory.create({
        data: {
          expenseId: resExp.id,
          actorId: req.user!.id,
          action: expense.status === ExpenseStatus.REJECTED ? 'RESUBMITTED' : 'SUBMITTED',
          previousStatus: expense.status,
          newStatus: ExpenseStatus.SUBMITTED,
          comment: req.body.comment || (expense.status === ExpenseStatus.REJECTED ? 'Resubmitted after addressing rejection' : 'Submitted for approval'),
        },
      });

      return resExp;
    });

    notifyExpenseSubmitted({
      ...updated,
      amount: parseFloat(updated.amount.toString()),
    });

    res.json({
      message: 'Expense claim submitted successfully',
      data: { ...updated, amount: parseFloat(updated.amount.toString()) },
    });
  } catch (error) {
    console.error('Error submitting expense:', error);
    res.status(500).json({ error: 'Failed to submit expense claim' });
  }
});

// POST /api/expenses/:id/approve - Manager/Admin Approval (Self-Approval Prohibited)
router.post('/:id/approve', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = approveExpenseSchema.safeParse(req.body);
    const comment = parsed.success ? parsed.data.comment : undefined;

    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        salesperson: { include: { user: true } },
      },
    });

    if (!expense) {
      res.status(404).json({ error: 'Expense claim not found' });
      return;
    }

    // Enforce Self-Approval Prevention
    if (expense.salesperson.userId === req.user!.id) {
      res.status(400).json({ error: 'Self-approval is strictly prohibited. An independent manager or administrator must review this claim.' });
      return;
    }

    // Manager Authority check
    if (req.user!.role === Role.MANAGER) {
      const isAssigned = await prisma.managerSalesperson.findFirst({
        where: {
          managerId: req.user!.id,
          salespersonId: expense.salespersonId,
        },
      });
      if (!isAssigned) {
        res.status(403).json({ error: 'Unauthorized to approve expenses for salespersons outside your team.' });
        return;
      }
    }

    // Must be in SUBMITTED status
    if (expense.status !== ExpenseStatus.SUBMITTED) {
      res.status(400).json({ error: `Cannot approve an expense with status: ${expense.status}. Only SUBMITTED claims can be approved.` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const resExp = await tx.expense.update({
        where: { id: expense.id },
        data: {
          status: ExpenseStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: req.user!.id,
        },
        include: {
          salesperson: { include: { user: true } },
          approver: { select: { id: true, name: true } },
        },
      });

      await tx.expenseHistory.create({
        data: {
          expenseId: resExp.id,
          actorId: req.user!.id,
          action: 'APPROVED',
          previousStatus: ExpenseStatus.SUBMITTED,
          newStatus: ExpenseStatus.APPROVED,
          comment: comment || 'Claim verified and approved for reimbursement',
        },
      });

      return resExp;
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'APPROVE_EXPENSE',
      module: 'EXPENSES',
      recordId: updated.id,
      newValue: {
        status: ExpenseStatus.APPROVED,
        amount: parseFloat(updated.amount.toString()),
      },
    });

    notifyExpenseApproved({
      ...updated,
      amount: parseFloat(updated.amount.toString()),
    });

    res.json({
      message: 'Expense claim approved successfully',
      data: { ...updated, amount: parseFloat(updated.amount.toString()) },
    });
  } catch (error) {
    console.error('Error approving expense:', error);
    res.status(500).json({ error: 'Failed to approve expense claim' });
  }
});

// POST /api/expenses/:id/reject - Manager/Admin Rejection (Requires Reason)
router.post('/:id/reject', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = rejectExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || 'A clear rejection reason is required.' });
      return;
    }

    const { rejectionReason } = parsed.data;

    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        salesperson: { include: { user: true } },
      },
    });

    if (!expense) {
      res.status(404).json({ error: 'Expense claim not found' });
      return;
    }

    // Manager Authority check
    if (req.user!.role === Role.MANAGER) {
      const isAssigned = await prisma.managerSalesperson.findFirst({
        where: {
          managerId: req.user!.id,
          salespersonId: expense.salespersonId,
        },
      });
      if (!isAssigned) {
        res.status(403).json({ error: 'Unauthorized to review expenses for salespersons outside your team.' });
        return;
      }
    }

    if (expense.status !== ExpenseStatus.SUBMITTED) {
      res.status(400).json({ error: `Cannot reject an expense with status: ${expense.status}. Only SUBMITTED claims can be rejected.` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const resExp = await tx.expense.update({
        where: { id: expense.id },
        data: {
          status: ExpenseStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedBy: req.user!.id,
          rejectionReason,
        },
        include: {
          salesperson: { include: { user: true } },
          rejecter: { select: { id: true, name: true } },
        },
      });

      await tx.expenseHistory.create({
        data: {
          expenseId: resExp.id,
          actorId: req.user!.id,
          action: 'REJECTED',
          previousStatus: ExpenseStatus.SUBMITTED,
          newStatus: ExpenseStatus.REJECTED,
          comment: rejectionReason,
        },
      });

      return resExp;
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'REJECT_EXPENSE',
      module: 'EXPENSES',
      recordId: updated.id,
      newValue: {
        status: ExpenseStatus.REJECTED,
        rejectionReason,
      },
    });

    notifyExpenseRejected({
      ...updated,
      amount: parseFloat(updated.amount.toString()),
    });

    res.json({
      message: 'Expense claim rejected',
      data: { ...updated, amount: parseFloat(updated.amount.toString()) },
    });
  } catch (error) {
    console.error('Error rejecting expense:', error);
    res.status(500).json({ error: 'Failed to reject expense claim' });
  }
});

// POST /api/expenses/:id/reimburse - Record Disbursed Reimbursement (Admin/Manager)
router.post('/:id/reimburse', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = reimburseExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || 'Payment reference and method are required.' });
      return;
    }

    const { reimbursementRef, reimbursementMethod, comment } = parsed.data;

    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        salesperson: { include: { user: true } },
      },
    });

    if (!expense) {
      res.status(404).json({ error: 'Expense claim not found' });
      return;
    }

    if (expense.status !== ExpenseStatus.APPROVED) {
      res.status(400).json({ error: `Only APPROVED expenses can be marked as reimbursed. Current status is ${expense.status}.` });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const resExp = await tx.expense.update({
        where: { id: expense.id },
        data: {
          status: ExpenseStatus.REIMBURSED,
          reimbursedAt: new Date(),
          reimbursedBy: req.user!.id,
          reimbursementRef,
          reimbursementMethod,
        },
        include: {
          salesperson: { include: { user: true } },
          reimburser: { select: { id: true, name: true } },
        },
      });

      await tx.expenseHistory.create({
        data: {
          expenseId: resExp.id,
          actorId: req.user!.id,
          action: 'REIMBURSED',
          previousStatus: ExpenseStatus.APPROVED,
          newStatus: ExpenseStatus.REIMBURSED,
          comment: comment || `Disbursed via ${reimbursementMethod} (Ref: ${reimbursementRef})`,
        },
      });

      return resExp;
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'REIMBURSE_EXPENSE',
      module: 'EXPENSES',
      recordId: updated.id,
      newValue: {
        status: ExpenseStatus.REIMBURSED,
        reimbursementRef,
        reimbursementMethod,
      },
    });

    notifyExpenseReimbursed({
      ...updated,
      amount: parseFloat(updated.amount.toString()),
    });

    res.json({
      message: 'Reimbursement recorded successfully',
      data: { ...updated, amount: parseFloat(updated.amount.toString()) },
    });
  } catch (error) {
    console.error('Error reimbursing expense:', error);
    res.status(500).json({ error: 'Failed to record expense reimbursement' });
  }
});

export default router;
