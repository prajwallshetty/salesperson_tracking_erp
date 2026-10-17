import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma, Role, SalespersonStatus, UserStatus } from '@/lib/db';
import { badRequest, forbidden, notFound } from '@/lib/http/errors';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';
import { joinManagerToTeam, notifyTeamChanged } from '@/lib/realtime/emitter';
import type { AuthenticatedUser } from '@/lib/permissions';

const createSalespersonSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email('A valid email address is required'),
  phone: z.string().trim().min(7, 'Valid phone number is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  employeeCode: z.string().trim().min(1),
  territory: z.string().trim().min(1),
  managerId: z.string().uuid().optional().nullable().or(z.literal('')),
});

export async function createSalesperson(user: AuthenticatedUser, body: any, actor: AuditActor) {
  const { name, email, phone, password, employeeCode, territory } = body || {};
  if (!name || !email || !phone || !password || !employeeCode || !territory) throw badRequest('Missing required salesperson fields');
  const parsed = createSalespersonSchema.safeParse(body);
  if (!parsed.success) throw badRequest(parsed.error.errors[0]?.message || 'Invalid salesperson details');
  const input = parsed.data;

  // Managers may only add salespersons to their own team (legacy accepted any managerId).
  let managerId = input.managerId || undefined;
  if (user.role === Role.MANAGER) {
    if (managerId && managerId !== user.id) throw forbidden('Managers can only add salespersons to their own team');
    managerId = user.id;
  } else if (managerId) {
    const mgr = await prisma.user.findUnique({ where: { id: managerId }, select: { role: true } });
    if (!mgr || mgr.role !== Role.MANAGER) throw notFound('Manager not found');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const result = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: { name: input.name, email: input.email, phone: input.phone, passwordHash, role: Role.SALESPERSON, status: UserStatus.ACTIVE },
    });
    const salesperson = await tx.salesperson.create({
      data: { userId: newUser.id, employeeCode: input.employeeCode, territory: input.territory, status: SalespersonStatus.OFF_DUTY },
    });
    if (managerId) await tx.managerSalesperson.create({ data: { managerId, salespersonId: salesperson.id } });
    return salesperson;
  });

  await logAuditEvent({
    actor,
    action: 'CREATE_SALESPERSON',
    module: 'SALESPERSON',
    recordId: result.id,
    newValue: { name: input.name, employeeCode: input.employeeCode, territory: input.territory },
  });
  // The manager's open sessions follow the new team member at once; admins and managers refresh lists.
  if (managerId) joinManagerToTeam(managerId, result.id);
  notifyTeamChanged({ salespersonId: result.id, managerId: managerId ?? null });
  return result;
}
