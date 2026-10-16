import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma, UserStatus } from '../db';
import { loginSchema, accessCodeLoginSchema } from '../shared';
import { config } from '../config';
import { authLimiter } from '../middleware/rateLimiter';
import { authenticateToken } from '../middleware/auth';
import { logAuditEvent } from '../middleware/audit';

const router = Router();

router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const payload = {
    ...req.body,
    identifier: req.body.identifier || req.body.email || req.body.phone,
  };
  const result = loginSchema.safeParse(payload);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message || 'Invalid input parameters' });
    return;
  }
  const { identifier, password, deviceId } = result.data;

  // Find user by email, phone, or employeeCode
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { phone: identifier },
        { salespersonProfile: { employeeCode: identifier } },
      ],
    },
    include: {
      salespersonProfile: true,
      managerPermissions: true,
      managedSalespersons: { select: { salespersonId: true } },
    },
  });

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (user.status !== UserStatus.ACTIVE) {
    res.status(403).json({ error: 'Account has been deactivated. Contact your administrator.' });
    return;
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    await logAuditEvent({
      req,
      userId: user.id,
      action: 'LOGIN_FAILED',
      module: 'AUTH',
      oldValue: { identifier },
    });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Update device ID if provided on salesperson profile
  if (deviceId && user.salespersonProfile) {
    await prisma.salesperson.update({
      where: { id: user.salespersonProfile.id },
      data: { deviceId },
    });
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  await logAuditEvent({
    req,
    userId: user.id,
    action: 'LOGIN_SUCCESS',
    module: 'AUTH',
    newValue: { role: user.role, email: user.email },
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      salespersonId: user.salespersonProfile?.id,
      employeeCode: user.salespersonProfile?.employeeCode,
      territory: user.salespersonProfile?.territory,
      dutyStatus: user.salespersonProfile?.status,
    },
    expiresIn: '7d',
  });
});

// POST /api/auth/access-code-login - Individual Access Code Authentication
router.post('/access-code-login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const result = accessCodeLoginSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message || 'Invalid input parameters' });
    return;
  }

  const { identifier, accessCode, deviceId } = result.data;

  // Find user by employee code, phone, or email
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { salespersonProfile: { employeeCode: identifier } },
        { phone: identifier },
        { email: identifier },
      ],
    },
    include: {
      salespersonProfile: true,
      managerPermissions: true,
      managedSalespersons: { select: { salespersonId: true } },
    },
  });

  // Generic rejection to prevent account enumeration
  if (!user || user.status !== UserStatus.ACTIVE) {
    res.status(401).json({ error: 'Invalid credentials or access code' });
    return;
  }

  // Find latest active access code
  const activeCode = await prisma.userAccessCode.findFirst({
    where: {
      userId: user.id,
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!activeCode) {
    res.status(401).json({ error: 'Invalid credentials or access code' });
    return;
  }

  // Check temporary lockout
  if (activeCode.lockedUntil && activeCode.lockedUntil > new Date()) {
    const remainingMinutes = Math.ceil((activeCode.lockedUntil.getTime() - Date.now()) / 60000);
    res.status(423).json({
      error: `Access code is temporarily locked due to repeated failed attempts. Please try again in ${remainingMinutes} minute(s).`,
    });
    return;
  }

  // Check expiration
  if (activeCode.expiresAt && activeCode.expiresAt < new Date()) {
    await prisma.userAccessCode.update({
      where: { id: activeCode.id },
      data: { status: 'EXPIRED' },
    });
    res.status(401).json({ error: 'Access code has expired. Please contact your manager or administrator.' });
    return;
  }

  // Verify cryptographic code hash
  const isValid = await bcrypt.compare(accessCode, activeCode.codeHash);
  if (!isValid) {
    const newFailedCount = activeCode.failedAttempts + 1;
    const shouldLock = newFailedCount >= 5;
    await prisma.userAccessCode.update({
      where: { id: activeCode.id },
      data: {
        failedAttempts: newFailedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });

    await logAuditEvent({
      req,
      userId: user.id,
      action: 'ACCESS_CODE_LOGIN_FAILED',
      module: 'AUTH',
      recordId: activeCode.id,
      oldValue: { failedAttempts: newFailedCount, locked: shouldLock },
    });

    if (shouldLock) {
      res.status(423).json({
        error: 'Access code is temporarily locked due to repeated failed attempts. Please try again in 15 minute(s).',
      });
      return;
    }

    res.status(401).json({ error: 'Invalid credentials or access code' });
    return;
  }

  // Reset lockout counters and record usage
  await prisma.userAccessCode.update({
    where: { id: activeCode.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastUsedAt: new Date(),
    },
  });

  if (deviceId && user.salespersonProfile) {
    await prisma.salesperson.update({
      where: { id: user.salespersonProfile.id },
      data: { deviceId },
    });
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  await logAuditEvent({
    req,
    userId: user.id,
    action: 'ACCESS_CODE_LOGIN_SUCCESS',
    module: 'AUTH',
    recordId: activeCode.id,
    newValue: { role: user.role, method: 'ACCESS_CODE' },
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      salespersonId: user.salespersonProfile?.id,
      employeeCode: user.salespersonProfile?.employeeCode,
      territory: user.salespersonProfile?.territory,
      dutyStatus: user.salespersonProfile?.status,
    },
    expiresIn: '7d',
  });
});

router.post('/logout', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  if (req.user) {
    await logAuditEvent({
      req,
      userId: req.user.id,
      action: 'LOGOUT',
      module: 'AUTH',
    });
  }
  res.json({ message: 'Logged out successfully' });
});

router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      salespersonProfile: true,
      managerPermissions: true,
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      salespersonId: user.salespersonProfile?.id,
      employeeCode: user.salespersonProfile?.employeeCode,
      territory: user.salespersonProfile?.territory,
      dutyStatus: user.salespersonProfile?.status,
      permissions: req.user.permissions,
    },
  });
});

export default router;
