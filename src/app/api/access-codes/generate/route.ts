import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma, Role, UserStatus } from '@/lib/db';
import { generateAccessCodeSchema } from '@/lib/validations/schemas';
import { authedRoute, json } from '@/lib/http/handler';
import { readJson } from '@/lib/http/request';
import { logAuditEvent, actorFrom } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

/** Unbiased base32 code without confusable characters (0/O, 1/I), e.g. "K7Q-M2X". */
function generateSecureAccessCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export const POST = authedRoute({ roles: [Role.SUPER_ADMIN, Role.MANAGER] }, async (ctx) => {
  const { user } = ctx;
  const parsed = generateAccessCodeSchema.safeParse(await readJson(ctx.req));
  if (!parsed.success) return json({ error: parsed.error.errors[0]?.message || 'Invalid parameters' }, 400);
  const { userId, expiresInDays } = parsed.data;

  if (user.role === Role.MANAGER) {
    const isAssigned = await prisma.managerSalesperson.findFirst({ where: { managerId: user.id, salesperson: { userId } } });
    if (!isAssigned) return json({ error: 'You are only authorized to generate access codes for your assigned team members.' }, 403);
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, include: { salespersonProfile: true } });
  if (!target) return json({ error: 'Target user not found' }, 404);
  if (target.status !== UserStatus.ACTIVE) return json({ error: 'Cannot issue an access code to an inactive user account.' }, 400);

  const plainCode = generateSecureAccessCode();
  const codeHash = await bcrypt.hash(plainCode, 10);
  const displayHint = `•••• ${plainCode.slice(-4)}`;
  const expiresAt = expiresInDays && expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86400000) : null;

  const record = await prisma.$transaction(async (tx) => {
    await tx.userAccessCode.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
    });
    return tx.userAccessCode.create({ data: { userId, codeHash, displayHint, status: 'ACTIVE', expiresAt, createdById: user.id } });
  });

  await logAuditEvent({
    actor: actorFrom(ctx),
    action: 'GENERATE_ACCESS_CODE',
    module: 'AUTH',
    recordId: record.id,
    newValue: { targetUserId: userId, targetUserName: target.name, expiresAt: expiresAt?.toISOString() || 'Never' },
  });

  // Plaintext is returned exactly once and never stored.
  return json(
    {
      message: 'Access code generated successfully. Record it immediately; it cannot be retrieved again.',
      accessCode: plainCode,
      plainAccessCode: plainCode,
      id: record.id,
      codeId: record.id,
      displayHint,
      expiresAt: record.expiresAt,
      userName: target.name,
      employeeName: target.name,
      employeeCode: target.salespersonProfile?.employeeCode,
      // What the employee must enter besides the code: the company they belong to.
      companyCode: user.tenantSlug,
      companyName: user.tenantName,
    },
    201
  );
});
