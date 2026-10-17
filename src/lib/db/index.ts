import { PrismaClient } from '@prisma/client';
import { createTenantClient } from './tenancy';

export * from '@prisma/client';
export { runWithTenant, currentTenantId, tryCurrentTenantId, DEFAULT_TENANT_ID, TenantContextError } from './tenancy';

const globalForPrisma = globalThis as unknown as {
  __salesgridPrismaRoot?: PrismaClient;
  __salesgridPrismaScoped?: ReturnType<typeof createTenantClient>;
};

/**
 * Unscoped client. ONLY for code that legitimately works across tenants or before a tenant is
 * known: login tenant resolution, session loading, tenant administration (CLI), health checks,
 * retention jobs, seeds and tests. Allow-list enforced by tests/unit/tenancy-guard.test.ts.
 */
export const prismaRoot =
  globalForPrisma.__salesgridPrismaRoot ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

/** Tenant-scoped client used by all application code: requires `runWithTenant()`. */
export const prisma = (globalForPrisma.__salesgridPrismaScoped ??= createTenantClient(prismaRoot));

// Reuse one client per process (Next.js dev hot reload, custom server + route handlers).
globalForPrisma.__salesgridPrismaRoot = prismaRoot;

/** Transaction client of the tenant-scoped `prisma` (use instead of Prisma.TransactionClient). */
export type TxClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
