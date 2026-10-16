import { prisma, type Prisma } from '@/lib/db';
import { badRequest, forbidden, notFound } from '@/lib/http/errors';
import { canAccessSalesperson, getAuthorizedSalespersonIds, type AuthenticatedUser } from '@/lib/permissions';

/** Prisma filter: clients with an active assignment to someone the user may access. */
export function clientScopeFilter(user: AuthenticatedUser): Prisma.ClientWhereInput {
  const ids = getAuthorizedSalespersonIds(user);
  if (ids === undefined) return {};
  return { assignments: { some: { salespersonId: { in: ids }, active: true } } };
}

/** Loads a client the user may act on, or throws 404/403 (legacy messages). */
export async function getAccessibleClient(user: AuthenticatedUser, clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { assignments: { where: { active: true }, select: { salespersonId: true } } },
  });
  if (!client) throw notFound('Client not found');
  const ids = getAuthorizedSalespersonIds(user);
  if (ids !== undefined && !client.assignments.some((a) => ids.includes(a.salespersonId))) {
    throw forbidden('You are not authorized to access this client');
  }
  return client;
}

export function assertSalespersonAccess(user: AuthenticatedUser, salespersonId: string, message = 'Access denied to this salesperson') {
  if (!canAccessSalesperson(user, salespersonId)) throw forbidden(message);
}

/**
 * Salesperson a record is created for:
 *  - salesperson → always themselves (body value ignored; cannot act for others)
 *  - admin → any existing salesperson in the body
 *  - manager → a salesperson in their team
 */
export async function resolveActingSalespersonId(user: AuthenticatedUser, requested: unknown, missingMessage: string): Promise<string> {
  if (user.salespersonId) return user.salespersonId;
  if ((user.role === 'SUPER_ADMIN' || user.role === 'MANAGER') && typeof requested === 'string' && requested) {
    assertSalespersonAccess(user, requested, 'You can only act on behalf of salespersons in your team');
    const exists = await prisma.salesperson.findUnique({ where: { id: requested }, select: { id: true } });
    if (!exists) throw notFound('Salesperson not found');
    return requested;
  }
  throw badRequest(missingMessage);
}
