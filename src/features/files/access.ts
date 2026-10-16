import { prisma } from '@/lib/db';
import { canAccessSalesperson, type AuthenticatedUser } from '@/lib/permissions';

/**
 * Per-record file authorization. A file may be read by:
 *  - a super admin;
 *  - the user who uploaded it (so a receipt can be previewed before the expense is saved);
 *  - anyone who can access a record that references it: payment proof, visit photo/signature/
 *    voice note, expense receipt (salesperson = own records, manager = team).
 * Files uploaded before ownership was recorded are readable through their referencing record
 * only. Everything else is reported as "not found" so file names cannot be probed.
 */
export async function canReadFile(user: AuthenticatedUser, filename: string): Promise<boolean> {
  if (user.role === 'SUPER_ADMIN') return true;

  const owner = await prisma.uploadedFile.findUnique({ where: { filename }, select: { uploadedById: true } });
  if (owner?.uploadedById === user.id) return true;

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
  return [...payments, ...visits, ...expenses].some((r) => canAccessSalesperson(user, r.salespersonId));
}
