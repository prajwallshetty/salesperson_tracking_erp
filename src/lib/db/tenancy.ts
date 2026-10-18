import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Tenant isolation for the database layer.
 *
 * Every business table carries `tenantId`. The application uses a Prisma client extended with
 * {@link createTenantClient}: inside `runWithTenant(tenantId, …)` every query on a tenant-owned
 * model is restricted to that tenant, every create stamps it, and `tenantId` can never be changed
 * by an update. Outside a tenant context a model query THROWS (fail closed) instead of returning
 * every company's rows. The tenant id always comes from the authenticated user's database row
 * (see `authedRoute`), never from the request.
 *
 * Not covered, by design: raw SQL (`$queryRaw` etc.) — those statements filter on tenantId
 * themselves — and the unscoped client `prismaRoot`, which is limited to the allow-list checked in
 * tests/unit/tenancy-guard.test.ts.
 */

/** Tenant that all pre-tenancy data was migrated into (see migration 2_multi_tenancy). */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export class TenantContextError extends Error {
  constructor(message = 'Tenant context is missing: this code must run inside runWithTenant()') {
    super(message);
    this.name = 'TenantContextError';
  }
}

// One AsyncLocalStorage per process even if Next.js bundles this module more than once.
const g = globalThis as unknown as { __salesgridTenantALS?: AsyncLocalStorage<{ tenantId: string }> };
const als = (g.__salesgridTenantALS ??= new AsyncLocalStorage<{ tenantId: string }>());

export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  if (!tenantId) throw new TenantContextError('runWithTenant() needs a tenant id');
  return als.run({ tenantId }, () => {
    const result = fn();
    // Prisma queries are lazy: `runWithTenant(t, () => prisma.x.findMany())` would otherwise return
    // a not-yet-started query that runs (and fails closed) after the context has ended. Starting it
    // here, inside the context, makes that shape safe.
    if (result && typeof (result as { then?: unknown }).then === 'function') return Promise.resolve(result) as T;
    return result;
  });
}

export function tryCurrentTenantId(): string | undefined {
  return als.getStore()?.tenantId;
}

export function currentTenantId(): string {
  const id = tryCurrentTenantId();
  if (!id) throw new TenantContextError();
  return id;
}

// ---------------------------------------------------------------------------------------------
// Model classification (derived from the schema, so a new model must be classified or startup fails)
// ---------------------------------------------------------------------------------------------

/** Models without a tenantId column that belong to a tenant through a parent relation. */
export const CHILD_MODELS: Record<string, string> = {
  OrderItem: 'order',
  ExpenseHistory: 'expense',
  ClientLedgerEntry: 'client',
  ClientAssignment: 'client',
  ManagerSalesperson: 'manager',
  ManagerPermission: 'user',
  QuotationItem: 'quotation',
  InvoiceItem: 'invoice',
};
/** Models that are intentionally global. */
export const GLOBAL_MODELS = new Set(['Tenant']);

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
export const TENANT_MODELS = new Set([...models.values()].filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name));

export function assertModelClassification() {
  for (const m of models.values()) {
    if (TENANT_MODELS.has(m.name) || GLOBAL_MODELS.has(m.name)) continue;
    const rel = CHILD_MODELS[m.name];
    if (!rel) throw new Error(`Model ${m.name} is not tenant-scoped: add tenantId, or classify it in src/lib/db/tenancy.ts`);
    const field = m.fields.find((f) => f.name === rel && f.kind === 'object');
    if (!field) throw new Error(`Model ${m.name}: relation "${rel}" not found`);
    const parent = models.get(field.type);
    if (!parent || !(TENANT_MODELS.has(parent.name) || CHILD_MODELS[parent.name])) {
      throw new Error(`Model ${m.name}: parent ${field.type} is not tenant-owned`);
    }
  }
}

/** The filter that restricts `model` to a tenant (direct column, or through its parent chain). */
export function tenantFilter(model: string, tenantId: string): Record<string, unknown> {
  if (TENANT_MODELS.has(model)) return { tenantId };
  const rel = CHILD_MODELS[model];
  if (!rel) return {};
  const parent = models.get(model)!.fields.find((f) => f.name === rel)!.type;
  return { [rel]: tenantFilter(parent, tenantId) };
}

// Foreign-key-owning relation fields: if present in `data` the input is the "checked" kind and the
// tenant must be attached as a relation instead of a scalar.
const fkRelations = new Map<string, Set<string>>(
  [...models.values()].map((m) => [m.name, new Set(m.fields.filter((f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0).map((f) => f.name))])
);

type Data = Record<string, unknown>;
const NESTED_WRITE_OPS_ALLOWED = new Set(['create', 'createMany', 'connectOrCreate', 'connect']);

/** Stamps tenantId on a create payload (and on nested creates); rejects a conflicting tenantId. */
export function stampTenant(model: string, data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampTenant(model, d, tenantId));
  if (!data || typeof data !== 'object') return data;
  const out: Data = { ...(data as Data) };
  const meta = models.get(model);
  if (!meta) return out;

  if (TENANT_MODELS.has(model)) {
    if (out.tenantId !== undefined && out.tenantId !== tenantId) throw new TenantContextError(`Refusing to write ${model} with a different tenantId`);
    const checked = [...(fkRelations.get(model) ?? [])].some((f) => out[f] !== undefined);
    if (checked) {
      if (out.tenant !== undefined) throw new TenantContextError(`Do not set "tenant" explicitly on ${model}`);
      out.tenant = { connect: { id: tenantId } };
    } else {
      delete out.tenant;
      out.tenantId = tenantId;
    }
  }

  for (const field of meta.fields) {
    if (field.kind !== 'object' || field.name === 'tenant') continue;
    const nested = out[field.name] as Data | undefined;
    if (!nested || typeof nested !== 'object') continue;
    const next: Data = { ...nested };
    for (const op of Object.keys(next)) {
      if (!NESTED_WRITE_OPS_ALLOWED.has(op)) throw new TenantContextError(`Nested "${op}" on ${model}.${field.name} is not supported by the tenant-scoped client`);
    }
    if (next.create !== undefined) next.create = stampTenant(field.type, next.create, tenantId);
    if (next.createMany && typeof next.createMany === 'object') {
      next.createMany = { ...(next.createMany as Data), data: stampTenant(field.type, (next.createMany as Data).data, tenantId) };
    }
    if (next.connectOrCreate !== undefined) {
      const stampCoc = (c: Data) => ({ ...c, where: scopeUniqueWhere(field.type, c.where as Data, tenantId), create: stampTenant(field.type, c.create, tenantId) });
      next.connectOrCreate = Array.isArray(next.connectOrCreate) ? next.connectOrCreate.map(stampCoc) : stampCoc(next.connectOrCreate as Data);
    }
    if (next.connect !== undefined) {
      const scope = (w: Data) => scopeUniqueWhere(field.type, w, tenantId);
      next.connect = Array.isArray(next.connect) ? next.connect.map(scope) : scope(next.connect as Data);
    }
    out[field.name] = next;
  }
  return out;
}

function scopeUniqueWhere(model: string, where: Data | undefined, tenantId: string): Data {
  return { ...(where ?? {}), ...tenantFilter(model, tenantId) };
}

const MANY_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany']);
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);
const CREATE_OPS = new Set(['create']);
const CREATE_MANY_OPS = new Set(['createMany', 'createManyAndReturn']);

function withoutTenantChange(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const { tenantId: _t, tenant: _tn, ...rest } = data as Data;
  return rest;
}

/** Pure transformation of Prisma query args; exported for unit tests. */
export function scopeArgs(model: string, operation: string, args: Data | undefined, tenantId: string): Data {
  const a: Data = { ...(args ?? {}) };
  const filter = tenantFilter(model, tenantId);
  const owned = TENANT_MODELS.has(model);

  if (MANY_OPS.has(operation)) {
    a.where = a.where ? { AND: [a.where, filter] } : filter;
    if (operation === 'updateMany') a.data = withoutTenantChange(a.data);
    return a;
  }
  if (UNIQUE_OPS.has(operation)) {
    a.where = { ...(a.where as Data), ...filter };
    if (operation === 'update') a.data = withoutTenantChange(a.data);
    return a;
  }
  if (operation === 'upsert') {
    a.where = { ...(a.where as Data), ...filter };
    a.create = owned ? stampTenant(model, a.create, tenantId) : a.create;
    a.update = withoutTenantChange(a.update);
    return a;
  }
  if (CREATE_OPS.has(operation)) {
    if (owned) a.data = stampTenant(model, a.data, tenantId);
    return a;
  }
  if (CREATE_MANY_OPS.has(operation)) {
    if (owned) a.data = stampTenant(model, a.data, tenantId);
    return a;
  }
  throw new TenantContextError(`Operation ${model}.${operation} is not supported by the tenant-scoped client`);
}

export function createTenantClient(base: PrismaClient) {
  assertModelClassification();
  return base.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (GLOBAL_MODELS.has(model)) return query(args);
          return query(scopeArgs(model, operation, args as Data, currentTenantId()) as typeof args);
        },
      },
    },
  });
}
