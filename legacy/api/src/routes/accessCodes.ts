import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma, Role, UserStatus } from '../db';
import { generateAccessCodeSchema, revokeAccessCodeSchema } from '../shared';
import { authenticateToken, requireRole } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

// Helper to generate a cryptographically strong, human-readable access code (e.g. TRK-9842 or 8 chars)
function generateSecureAccessCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 without easily confused 0/O, 1/I
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

// GET /api/access-codes - List all staff access codes (admin/manager scoped)
router.get('/', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  try {
    const userRole = req.user!.role;
    const userId = req.user!.id;

    let userFilter: any = {};
    if (userRole === Role.MANAGER) {
      // Find salespersons assigned to this manager
      const managed = await prisma.managerSalesperson.findMany({
        where: { managerId: userId },
        include: { salesperson: true },
      });
      const salespersonUserIds = managed.map((m) => m.salesperson.userId);
      userFilter = { id: { in: salespersonUserIds } };
    }

    const codes = await prisma.userAccessCode.findMany({
      where: {
        user: userFilter,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            status: true,
            salespersonProfile: {
              select: {
                id: true,
                employeeCode: true,
                territory: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = codes.map((c) => ({
      id: c.id,
      userId: c.userId,
      userName: c.user.name,
      userEmail: c.user.email,
      userPhone: c.user.phone,
      employeeCode: c.user.salespersonProfile?.employeeCode || null,
      territory: c.user.salespersonProfile?.territory || null,
      role: c.user.role,
      userStatus: c.user.status,
      displayHint: c.displayHint,
      status: c.status,
      expiresAt: c.expiresAt?.toISOString() || null,
      failedAttempts: c.failedAttempts,
      isLocked: Boolean(c.lockedUntil && c.lockedUntil > new Date()),
      lockedUntil: c.lockedUntil?.toISOString() || null,
      lastUsedAt: c.lastUsedAt?.toISOString() || null,
      createdAt: c.createdAt.toISOString(),
    }));

    res.json({ data: result });
  } catch (error) {
    console.error('Error fetching access codes:', error);
    res.status(500).json({ error: 'Failed to retrieve access codes' });
  }
});

// POST /api/access-codes/generate - Generate individual access code (One-Time Plaintext Delivery)
router.post('/generate', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = generateAccessCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid parameters' });
      return;
    }

    const { userId, expiresInDays } = parsed.data;

    // Check manager authority over user
    if (req.user!.role === Role.MANAGER) {
      const isAssigned = await prisma.managerSalesperson.findFirst({
        where: {
          managerId: req.user!.id,
          salesperson: { userId },
        },
      });
      if (!isAssigned) {
        res.status(403).json({ error: 'You are only authorized to generate access codes for your assigned team members.' });
        return;
      }
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { salespersonProfile: true },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Target user not found' });
      return;
    }

    if (targetUser.status !== UserStatus.ACTIVE) {
      res.status(400).json({ error: 'Cannot issue an access code to an inactive user account.' });
      return;
    }

    // Generate cryptographic access code
    const plainCode = generateSecureAccessCode();
    const codeHash = await bcrypt.hash(plainCode, 10);
    const displayHint = `•••• ${plainCode.slice(-4)}`;

    const expiresAt = expiresInDays && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    // Invalidate/Revoke previous active codes for this user
    await prisma.userAccessCode.updateMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: req.user!.id,
      },
    });

    // Create new code record
    const record = await prisma.userAccessCode.create({
      data: {
        userId,
        codeHash,
        displayHint,
        status: 'ACTIVE',
        expiresAt,
        createdById: req.user!.id,
      },
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'GENERATE_ACCESS_CODE',
      module: 'AUTH',
      recordId: record.id,
      newValue: {
        targetUserId: userId,
        targetUserName: targetUser.name,
        expiresAt: expiresAt?.toISOString() || 'Never',
      },
    });

    // Return plaintext code ONCE
    res.status(201).json({
      message: 'Access code generated successfully. Record it immediately; it cannot be retrieved again.',
      accessCode: plainCode,
      plainAccessCode: plainCode,
      id: record.id,
      codeId: record.id,
      displayHint,
      expiresAt: record.expiresAt,
      userName: targetUser.name,
      employeeName: targetUser.name,
      employeeCode: targetUser.salespersonProfile?.employeeCode,
    });
  } catch (error) {
    console.error('Error generating access code:', error);
    res.status(500).json({ error: 'Failed to generate access code' });
  }
});

// POST /api/access-codes/revoke - Revoke an access code
router.post('/revoke', authenticateToken, requireRole(Role.SUPER_ADMIN, Role.MANAGER), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = revokeAccessCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid codeId or userId is required' });
      return;
    }

    const { codeId, userId } = parsed.data;

    let targetCode = null;
    if (codeId) {
      targetCode = await prisma.userAccessCode.findUnique({ where: { id: codeId } });
    } else if (userId) {
      targetCode = await prisma.userAccessCode.findFirst({
        where: { userId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!targetCode) {
      res.status(404).json({ error: 'Active access code not found' });
      return;
    }

    // Check manager authority
    if (req.user!.role === Role.MANAGER) {
      const isAssigned = await prisma.managerSalesperson.findFirst({
        where: {
          managerId: req.user!.id,
          salesperson: { userId: targetCode.userId },
        },
      });
      if (!isAssigned) {
        res.status(403).json({ error: 'Unauthorized to revoke access codes for this user.' });
        return;
      }
    }

    await prisma.userAccessCode.update({
      where: { id: targetCode.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: req.user!.id,
      },
    });

    await logAuditEvent({
      req,
      userId: req.user!.id,
      action: 'REVOKE_ACCESS_CODE',
      module: 'AUTH',
      recordId: targetCode.id,
      newValue: { status: 'REVOKED' },
    });

    res.json({ message: 'Access code revoked successfully' });
  } catch (error) {
    console.error('Error revoking access code:', error);
    res.status(500).json({ error: 'Failed to revoke access code' });
  }
});

export default router;
