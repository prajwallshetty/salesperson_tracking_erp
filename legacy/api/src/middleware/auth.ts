import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, Role, UserStatus } from '../db';
import { config } from '../config';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: UserStatus;
  salespersonId?: string;
  employeeCode?: string;
  territory?: string;
  managedSalespersonIds?: string[];
  permissions?: Record<string, boolean>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  // Fallback to query parameter token for browser download/receipt tabs
  if (!token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        salespersonProfile: true,
        managerPermissions: true,
        managedSalespersons: {
          select: { salespersonId: true },
        },
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      res.status(401).json({ error: 'User is inactive or session is invalid' });
      return;
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      salespersonId: user.salespersonProfile?.id,
      employeeCode: user.salespersonProfile?.employeeCode,
      territory: user.salespersonProfile?.territory,
      managedSalespersonIds: user.managedSalespersons.map((ms) => ms.salespersonId),
      permissions: user.managerPermissions ? {
        canViewDashboard: user.managerPermissions.canViewDashboard,
        canManageUsers: user.managerPermissions.canManageUsers,
        canManageProducts: user.managerPermissions.canManageProducts,
        canManageClients: user.managerPermissions.canManageClients,
        canAssignClients: user.managerPermissions.canAssignClients,
        canViewGps: user.managerPermissions.canViewGps,
        canViewOrders: user.managerPermissions.canViewOrders,
        canApproveOrders: user.managerPermissions.canApproveOrders,
        canViewPayments: user.managerPermissions.canViewPayments,
        canVerifyPayments: user.managerPermissions.canVerifyPayments,
        canViewReports: user.managerPermissions.canViewReports,
        canExportReports: user.managerPermissions.canExportReports,
      } : undefined,
    };

    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

export function requireRole(...roles: (Role | Role[])[]) {
  const flatRoles = roles.flat();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role === Role.SUPER_ADMIN) {
      next();
      return;
    }

    if (!flatRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: Insufficient privileges for this role' });
      return;
    }

    next();
  };
}

export const requireRoles = requireRole;

export function requireManagerPermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role === Role.SUPER_ADMIN) {
      next();
      return;
    }

    if (req.user.role === Role.MANAGER) {
      if (!req.user.permissions || !req.user.permissions[permissionKey]) {
        res.status(403).json({ error: `Forbidden: Missing required permission [${permissionKey}]` });
        return;
      }
      next();
      return;
    }

    res.status(403).json({ error: 'Forbidden: Manager or Admin access required' });
  };
}

/**
 * Returns salesperson IDs that current user is authorized to view/manage:
 * - SUPER_ADMIN: undefined (all)
 * - MANAGER: list of managed salesperson IDs
 * - SALESPERSON: [req.user.salespersonId]
 */
export function getAuthorizedSalespersonIds(user: AuthenticatedUser): string[] | undefined {
  if (user.role === Role.SUPER_ADMIN) {
    return undefined; // unbounded
  }
  if (user.role === Role.MANAGER) {
    return user.managedSalespersonIds || [];
  }
  if (user.role === Role.SALESPERSON && user.salespersonId) {
    return [user.salespersonId];
  }
  return [];
}
