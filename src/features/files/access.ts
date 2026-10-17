import { prisma, prismaRoot, DEFAULT_TENANT_ID } from '@/lib/db';
import { canAccessSalesperson, type AuthenticatedUser } from '@/lib/permissions';

/**
 * Per-record, per-company file authorization. Files live in one directory, so the check is made
 * against the database, all of it scoped to the caller's company. A file may be read by:
 *  - the user who uploaded it (so a receipt can be previewed before the expense is saved);
 *  - anyone who can access a payment, visit or expense of THEIR company that references it
 *    (super admin: every record of the company; manager: team; salesperson: own);
 *  - a super admin, when the file is in their company's ownership table;
 *  - a super admin of the default company, for pre-ownership files nothing references (the legacy
 *    upload directory belongs to the company that existed before multi-tenancy).
 * Everything else is reported as "not found" so file names cannot be probed.
 */
export async function canReadFile(user: AuthenticatedUser, filename: string): Promise<boolean> {
  const owner = await prisma.uploadedFile.findFirst({ where: { filename }, select: { uploadedById: true } }); // tenant-scoped
  if (owner?.uploadedById === user.id) return true;
  if (owner && user.role === 'SUPER_ADMIN') return true;

  const suffix = `/${filename}`;
  const [payments, visits, expenses] = await Promise.all([
    prisma.payment.findMany({ where: { proofUrl: { endsWith: suffix } }, select: { salespersonId: true }, take: 20 }),
    prisma.clientVisit.findMany({
      where: {
        OR: [{ photoUrl: { endsWith: suffix } }, { signatureUrl: { endsWith: suffix } }, { voiceNoteUrl: { endsWith: suffix } }],
      },
      select: { salespersonId: true },
      take: 20,
    }),
    prisma.expense.findMany({ where: { receiptUrl: { endsWith: suffix } }, select: { salespersonId: true }, take: 20 }),
  ]);
  const referencing = [...payments, ...visits, ...expenses];
  if (referencing.some((r) => canAccessSalesperson(user, r.salespersonId))) return true;
  if (user.role === 'SUPER_ADMIN' && referencing.length > 0) return true;

  // Legacy, unowned and unreferenced: attributable only to the pre-tenancy company. "Unowned" must
  // be checked across ALL companies (unscoped): another company's fresh upload also looks unowned
  // from here, and must not be readable.
  if (!owner && referencing.length === 0 && user.role === 'SUPER_ADMIN' && user.tenantId === DEFAULT_TENANT_ID) {
    const ownedByAnyone = await prismaRoot.uploadedFile.findUnique({ where: { filename }, select: { id: true } });
    return !ownedByAnyone;
  }
  return false;
}
