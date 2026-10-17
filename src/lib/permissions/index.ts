/**
 * Role & permission model — shared by server (authorization) and client (navigation).
 *
 * Mirrors the legacy rules:
 *  - SUPER_ADMIN passes every role/permission check.
 *  - MANAGER is limited to their assigned salespersons (ManagerSalesperson) and to the
 *    12 boolean flags stored in ManagerPermission.
 *  - SALESPERSON sees only their own records.
 */

export type Role = 'SUPER_ADMIN' | 'MANAGER' | 'SALESPERSON';

export const MANAGER_PERMISSION_KEYS = [
  'canViewDashboard',
  'canManageUsers',
  'canManageProducts',
  'canManageClients',
  'canAssignClients',
  'canViewGps',
  'canViewOrders',
  'canApproveOrders',
  'canViewPayments',
  'canVerifyPayments',
  'canViewReports',
  'canExportReports',
] as const;

export type ManagerPermissionKey = (typeof MANAGER_PERMISSION_KEYS)[number];
export type PermissionMap = Record<ManagerPermissionKey, boolean>;

/**
 * Column defaults from `ManagerPermission` in schema.prisma. A manager whose permission row
 * was never created gets exactly what a freshly created row would have given them.
 */
export const DEFAULT_MANAGER_PERMISSIONS: PermissionMap = {
  canViewDashboard: true,
  canManageUsers: false,
  canManageProducts: true,
  canManageClients: true,
  canAssignClients: true,
  canViewGps: true,
  canViewOrders: true,
  canApproveOrders: true,
  canViewPayments: true,
  canVerifyPayments: true,
  canViewReports: true,
  canExportReports: true,
};

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: string;
  /** Server-only: current session version (see users.tokenVersion). */
  tokenVersion?: number;
  /** Server-only: the company this user belongs to. Always read from the database, never from the client. */
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  /** Subscription end (ISO) or null for no expiry. */
  tenantActiveUntil: string | null;
  salespersonId?: string;
  employeeCode?: string;
  territory?: string;
  managedSalespersonIds?: string[];
  permissions?: PermissionMap;
}

export function hasRole(user: Pick<AuthenticatedUser, 'role'> | null | undefined, ...roles: Role[]): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  return roles.includes(user.role);
}

export function hasPermission(
  user: Pick<AuthenticatedUser, 'role' | 'permissions'> | null | undefined,
  key: ManagerPermissionKey
): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.role === 'MANAGER') return Boolean((user.permissions ?? DEFAULT_MANAGER_PERMISSIONS)[key]);
  return false;
}

/** Whether a user may use the admin/manager console at all. */
export function isConsoleUser(user: Pick<AuthenticatedUser, 'role'> | null | undefined): boolean {
  return !!user && (user.role === 'SUPER_ADMIN' || user.role === 'MANAGER');
}

/** Landing page after login for each role. */
export function homePathForRole(role: Role): string {
  return role === 'SALESPERSON' ? '/field' : '/dashboard';
}

/**
 * Salesperson IDs the user may access:
 *  - SUPER_ADMIN → undefined (unbounded)
 *  - MANAGER     → assigned team
 *  - SALESPERSON → [own id]
 */
export function getAuthorizedSalespersonIds(user: AuthenticatedUser): string[] | undefined {
  if (user.role === 'SUPER_ADMIN') return undefined;
  if (user.role === 'MANAGER') return user.managedSalespersonIds || [];
  if (user.role === 'SALESPERSON' && user.salespersonId) return [user.salespersonId];
  return [];
}

export function canAccessSalesperson(user: AuthenticatedUser, salespersonId: string): boolean {
  const ids = getAuthorizedSalespersonIds(user);
  return ids === undefined || ids.includes(salespersonId);
}

/**
 * Prisma filter for a `salespersonId` column honouring an optional requested ID.
 *
 * Legacy defect fixed here: the old API replaced the caller's scope with `?salespersonId=`,
 * letting a salesperson read a colleague's records. A requested ID outside scope now yields
 * an impossible filter (empty result), matching how out-of-scope lists already behaved.
 */
export function scopedSalespersonFilter(
  user: AuthenticatedUser,
  requestedId?: string | null
): string | { in: string[] } | undefined {
  const ids = getAuthorizedSalespersonIds(user);
  if (requestedId) {
    if (ids === undefined || ids.includes(requestedId)) return requestedId;
    return { in: [] };
  }
  return ids === undefined ? undefined : { in: ids };
}
