import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __salesgridPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__salesgridPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

// Reuse one client per process (Next.js dev hot reload, custom server + route handlers).
globalForPrisma.__salesgridPrisma = prisma;
