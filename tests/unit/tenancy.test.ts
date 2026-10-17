import { describe, it, expect } from 'vitest';
import {
  runWithTenant,
  currentTenantId,
  tryCurrentTenantId,
  scopeArgs,
  stampTenant,
  tenantFilter,
  assertModelClassification,
  TENANT_MODELS,
  CHILD_MODELS,
  GLOBAL_MODELS,
  TenantContextError,
} from '@/lib/db/tenancy';
import { Prisma } from '@prisma/client';

const T = 'tenant-a';

describe('tenant context', () => {
  it('is only available inside runWithTenant and fails closed outside', () => {
    expect(tryCurrentTenantId()).toBeUndefined();
    expect(() => currentTenantId()).toThrow(TenantContextError);
    expect(runWithTenant(T, () => currentTenantId())).toBe(T);
    expect(() => runWithTenant('', () => 1)).toThrow(TenantContextError);
  });

  it('survives awaits and parallel work without mixing tenants', async () => {
    const read = async (t: string, ms: number) =>
      runWithTenant(t, async () => {
        await new Promise((r) => setTimeout(r, ms));
        return currentTenantId();
      });
    expect(await Promise.all([read('a', 30), read('b', 5), read('c', 15)])).toEqual(['a', 'b', 'c']);
  });

  it('starts lazy thenables (Prisma queries) inside the context', async () => {
    let seen: string | undefined;
    const lazy = { then: (resolve: (v: string) => void) => ((seen = tryCurrentTenantId()), resolve('done')) };
    expect(await runWithTenant(T, () => lazy as unknown as Promise<string>)).toBe('done');
    expect(seen).toBe(T);
  });
});

describe('model classification', () => {
  it('every model is tenant-owned, a child of a tenant-owned parent, or explicitly global', () => {
    expect(() => assertModelClassification()).not.toThrow();
    const all = Prisma.dmmf.datamodel.models.map((m) => m.name);
    for (const m of all) expect(TENANT_MODELS.has(m) || CHILD_MODELS[m] || GLOBAL_MODELS.has(m)).toBeTruthy();
    for (const m of ['User', 'Client', 'Order', 'Payment', 'Product', 'LocationPoint', 'AuditLog', 'UserAccessCode', 'UploadedFile', 'IdempotencyKey', 'SystemSetting']) {
      expect(TENANT_MODELS.has(m)).toBe(true);
    }
  });

  it('children are restricted through their parent chain', () => {
    expect(tenantFilter('Client', T)).toEqual({ tenantId: T });
    expect(tenantFilter('OrderItem', T)).toEqual({ order: { tenantId: T } });
    expect(tenantFilter('ClientLedgerEntry', T)).toEqual({ client: { tenantId: T } });
    expect(tenantFilter('ManagerPermission', T)).toEqual({ user: { tenantId: T } });
  });
});

describe('query scoping', () => {
  it('adds the tenant to reads, aggregates and bulk writes without losing the caller’s filter', () => {
    expect(scopeArgs('Order', 'findMany', { where: { status: 'X' } }, T).where).toEqual({ AND: [{ status: 'X' }, { tenantId: T }] });
    expect(scopeArgs('Order', 'findMany', undefined, T).where).toEqual({ tenantId: T });
    expect(scopeArgs('Order', 'count', { where: {} }, T).where).toEqual({ AND: [{}, { tenantId: T }] });
    expect(scopeArgs('Payment', 'groupBy', { by: ['status'], where: { a: 1 } }, T).where).toEqual({ AND: [{ a: 1 }, { tenantId: T }] });
    expect(scopeArgs('OrderItem', 'groupBy', { by: ['productId'] }, T).where).toEqual({ order: { tenantId: T } });
    expect(scopeArgs('Client', 'deleteMany', { where: { id: 'x' } }, T).where).toEqual({ AND: [{ id: 'x' }, { tenantId: T }] });
  });

  it('pins unique lookups, updates and deletes to the tenant, and never lets an update move a row', () => {
    expect(scopeArgs('Client', 'findUnique', { where: { id: 'c1' } }, T).where).toEqual({ id: 'c1', tenantId: T });
    expect(scopeArgs('Client', 'update', { where: { id: 'c1' }, data: { name: 'n', tenantId: 'other', tenant: { connect: { id: 'o' } } } }, T)).toEqual({
      where: { id: 'c1', tenantId: T },
      data: { name: 'n' },
    });
    expect(scopeArgs('Client', 'updateMany', { where: {}, data: { tenantId: 'other', city: 'x' } }, T).data).toEqual({ city: 'x' });
    expect(scopeArgs('Order', 'delete', { where: { id: 'o1' } }, T).where).toEqual({ id: 'o1', tenantId: T });
    const up = scopeArgs('SystemSetting', 'upsert', { where: { id: 'x' }, create: { key: 'k', value: 'v' }, update: { tenantId: 'other', value: 'w' } }, T);
    expect(up.create).toEqual({ key: 'k', value: 'v', tenantId: T });
    expect(up.update).toEqual({ value: 'w' });
  });

  it('stamps creates, overrides nothing silently, and refuses a conflicting tenant', () => {
    expect(scopeArgs('Client', 'create', { data: { name: 'n' } }, T).data).toEqual({ name: 'n', tenantId: T });
    expect(scopeArgs('Client', 'createMany', { data: [{ name: 'a' }, { name: 'b' }] }, T).data).toEqual([
      { name: 'a', tenantId: T },
      { name: 'b', tenantId: T },
    ]);
    expect(() => scopeArgs('Client', 'create', { data: { name: 'n', tenantId: 'other' } }, T)).toThrow(TenantContextError);
    expect(scopeArgs('Client', 'create', { data: { name: 'n', tenantId: T } }, T).data).toEqual({ name: 'n', tenantId: T });
  });

  it('uses a relation connect when the create is expressed with relations (checked input)', () => {
    const data = scopeArgs('Order', 'create', { data: { client: { connect: { id: 'c' } }, salesperson: { connect: { id: 's' } } } }, T).data as any;
    expect(data.tenant).toEqual({ connect: { id: T } });
    expect(data.tenantId).toBeUndefined();
    // …and the connect targets are themselves pinned to the tenant.
    expect(data.client.connect).toEqual({ id: 'c', tenantId: T });
    expect(data.salesperson.connect).toEqual({ id: 's', tenantId: T });
  });

  it('stamps nested creates and pins nested connects; unsupported nested writes fail closed', () => {
    const out = stampTenant('User', { name: 'u', salespersonProfile: { create: { employeeCode: 'E1', territory: 't' } } }, T) as any;
    expect(out.tenantId).toBe(T);
    expect(out.salespersonProfile.create.tenantId).toBe(T);
    expect(() => stampTenant('User', { salespersonProfile: { update: { territory: 'x' } } }, T)).toThrow(TenantContextError);
    expect(() => scopeArgs('Client', 'findRaw', {}, T)).toThrow(TenantContextError);
  });
});
