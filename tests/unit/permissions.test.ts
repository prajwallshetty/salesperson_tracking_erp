import { describe, it, expect } from 'vitest';
import { getAuthorizedSalespersonIds, hasPermission, hasRole, homePathForRole, scopedSalespersonFilter, type AuthenticatedUser } from '@/lib/permissions';

const base = { id: 'u', name: 'n', email: 'e', phone: 'p', status: 'ACTIVE', tenantId: 't1', tenantSlug: 'default', tenantName: 'Default', tenantActiveUntil: null };
const admin: AuthenticatedUser = { ...base, role: 'SUPER_ADMIN' };
const manager: AuthenticatedUser = { ...base, role: 'MANAGER', managedSalespersonIds: ['a', 'b'] };
const sp: AuthenticatedUser = { ...base, role: 'SALESPERSON', salespersonId: 'a' };

describe('permissions', () => {
  it('scopes salesperson ids per role', () => {
    expect(getAuthorizedSalespersonIds(admin)).toBeUndefined();
    expect(getAuthorizedSalespersonIds(manager)).toEqual(['a', 'b']);
    expect(getAuthorizedSalespersonIds(sp)).toEqual(['a']);
    expect(getAuthorizedSalespersonIds({ ...base, role: 'SALESPERSON' })).toEqual([]);
  });

  it('never widens scope through a requested salesperson id', () => {
    expect(scopedSalespersonFilter(sp, 'b')).toEqual({ in: [] });
    expect(scopedSalespersonFilter(sp, 'a')).toBe('a');
    expect(scopedSalespersonFilter(manager, 'c')).toEqual({ in: [] });
    expect(scopedSalespersonFilter(manager, null)).toEqual({ in: ['a', 'b'] });
    expect(scopedSalespersonFilter(admin, 'c')).toBe('c');
    expect(scopedSalespersonFilter(admin)).toBeUndefined();
  });

  it('applies manager permission flags with schema defaults', () => {
    expect(hasPermission(admin, 'canManageUsers')).toBe(true);
    expect(hasPermission(manager, 'canViewGps')).toBe(true); // default
    expect(hasPermission(manager, 'canManageUsers')).toBe(false); // default
    expect(hasPermission({ ...manager, permissions: { ...({} as any), canViewGps: false } }, 'canViewGps')).toBe(false);
    expect(hasPermission(sp, 'canViewOrders')).toBe(false);
  });

  it('role checks and landing pages', () => {
    expect(hasRole(admin, 'MANAGER')).toBe(true);
    expect(hasRole(sp, 'MANAGER')).toBe(false);
    expect(homePathForRole('SALESPERSON')).toBe('/field');
    expect(homePathForRole('MANAGER')).toBe('/dashboard');
  });
});
