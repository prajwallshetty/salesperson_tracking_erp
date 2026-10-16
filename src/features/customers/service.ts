import { prisma, AssignmentType, LedgerEntryType, Role } from '@/lib/db';
import { clientCreateSchema } from '@/lib/validations/schemas';
import { badRequest, forbidden, notFound } from '@/lib/http/errors';
import { assertSalespersonAccess } from '@/lib/services/access';
import { createNotification } from '@/lib/services/notifications';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import { notifyClientAssigned } from '@/lib/realtime/emitter';
import type { AuthenticatedUser } from '@/lib/permissions';

export async function createClient(user: AuthenticatedUser, rawInput: unknown, actor: AuditActor) {
  const parsed = clientCreateSchema.parse(rawInput);
  if (parsed.assignedSalespersonId) {
    assertSalespersonAccess(user, parsed.assignedSalespersonId, 'You can only assign clients to salespersons in your team');
  }

  const client = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        name: parsed.name,
        businessName: parsed.businessName,
        contactPerson: parsed.contactPerson,
        phone: parsed.phone,
        email: parsed.email || null,
        gstNumber: parsed.gstNumber || null,
        address: parsed.address,
        city: parsed.city,
        state: parsed.state,
        pincode: parsed.pincode,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        category: parsed.category,
        creditLimit: parsed.creditLimit,
        paymentTerms: parsed.paymentTerms,
        notes: parsed.notes,
        openingBalance: parsed.openingBalance,
        currentOutstanding: parsed.openingBalance,
      },
    });
    if (parsed.openingBalance > 0) {
      await tx.clientLedgerEntry.create({
        data: {
          clientId: created.id,
          entryType: LedgerEntryType.OPENING_BALANCE,
          amount: parsed.openingBalance,
          runningBalance: parsed.openingBalance,
          description: 'Opening balance initialized',
        },
      });
    }
    if (parsed.assignedSalespersonId) {
      await tx.clientAssignment.create({
        data: { clientId: created.id, salespersonId: parsed.assignedSalespersonId, assignedBy: user.id, type: AssignmentType.PRIMARY, active: true },
      });
    }
    return created;
  });

  await logAuditEvent({ actor, action: 'CREATE_CLIENT', module: 'CLIENT', recordId: client.id, newValue: client });
  return client;
}

export async function assignClient(
  user: AuthenticatedUser,
  clientId: string,
  body: { primarySalespersonId?: string; backupSalespersonId?: string; notes?: string },
  actor: AuditActor
) {
  const { primarySalespersonId, backupSalespersonId, notes } = body || {};
  if (!primarySalespersonId) throw badRequest('primarySalespersonId is required');
  if (backupSalespersonId && backupSalespersonId === primarySalespersonId) {
    throw badRequest('Backup salesperson must differ from the primary salesperson');
  }
  for (const id of [primarySalespersonId, backupSalespersonId].filter(Boolean) as string[]) {
    assertSalespersonAccess(user, id, 'You can only assign clients to salespersons in your team');
    const exists = await prisma.salesperson.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw notFound('Salesperson not found');
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, include: { assignments: { where: { active: true } } } });
  if (!client) throw notFound('Client not found');

  // A manager may only re-assign clients currently held by their team (or unassigned ones).
  if (user.role === Role.MANAGER && client.assignments.length > 0) {
    const team = user.managedSalespersonIds || [];
    if (!client.assignments.some((a) => team.includes(a.salespersonId))) {
      throw forbidden('This client is assigned outside your team');
    }
  }

  // History is kept: previous assignments are deactivated, never deleted (legacy Section 7.2).
  await prisma.$transaction(async (tx) => {
    await tx.clientAssignment.updateMany({ where: { clientId, active: true }, data: { active: false } });
    await tx.clientAssignment.create({
      data: { clientId, salespersonId: primarySalespersonId, assignedBy: user.id, type: AssignmentType.PRIMARY, active: true, notes },
    });
    if (backupSalespersonId) {
      await tx.clientAssignment.create({
        data: { clientId, salespersonId: backupSalespersonId, assignedBy: user.id, type: AssignmentType.BACKUP, active: true, notes },
      });
    }
  });

  const primarySp = await prisma.salesperson.findUnique({ where: { id: primarySalespersonId }, select: { userId: true } });
  if (primarySp) {
    await createNotification({
      recipientId: primarySp.userId,
      role: Role.SALESPERSON,
      title: 'Client Assigned',
      message: `${client.name} has been assigned to your territory.`,
      type: 'ASSIGNMENT',
    });
  }
  notifyClientAssigned(primarySalespersonId, { clientId, clientName: client.name, type: 'PRIMARY' });
  await logAuditEvent({
    actor,
    action: 'REASSIGN_CLIENT',
    module: 'CLIENT_ASSIGNMENT',
    recordId: clientId,
    oldValue: client.assignments,
    newValue: { primarySalespersonId, backupSalespersonId, notes },
  });
}
