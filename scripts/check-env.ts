/**
 * Validates runtime configuration and database connectivity before a deploy/start.
 *   npm run check:env
 * Exits non-zero on any problem. Reads .env files the same way the server does.
 */
import '../src/lib/loadEnv';
import { readdirSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { validateConfig } from '../src/lib/config';

async function main() {
  const result = validateConfig();
  const problems = [...result.errors];
  if (process.env.NODE_ENV === 'production' && process.env.DEV_QUICK_LOGIN === 'true') {
    problems.push('DEV_QUICK_LOGIN=true is set. It is ignored in production, but remove it from the production environment.');
  }
  if (!process.env.UPLOAD_DIR) problems.push('UPLOAD_DIR is not set (defaults to ./uploads — use persistent storage in production).');

  if (process.env.DATABASE_URL) {
    const prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const pending = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NULL`.catch(() => null);
      if (pending === null) problems.push('Database has no _prisma_migrations table: baseline it with `npm run db:baseline` (existing db) or run `npm run db:migrate` (new db).');
      else if (Number(pending[0].n) > 0) problems.push('A migration is in a failed/unfinished state — inspect `npx prisma migrate status`.');
      else {
        const applied = new Set(
          (await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`).map((r) => r.migration_name)
        );
        const dir = path.join(process.cwd(), 'prisma', 'migrations');
        const missing = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !applied.has(d.name)).map((d) => d.name);
        const tenants = Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "tenants"`.catch(() => [{ n: BigInt(-1) }]))[0].n);
        if (tenants === 0) problems.push('No company exists: run `npm run tenant -- list` / `create` (the migration normally creates the default company).');
        if (missing.length) problems.push(`Migrations not applied yet: ${missing.join(', ')} — review the SQL, then run \`npm run db:migrate\`.`);
      }
    } catch (e) {
      problems.push(`Cannot connect to DATABASE_URL: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      await prisma.$disconnect();
    }
  }

  if (process.env.REDIS_URL && /^rediss?:\/\//.test(process.env.REDIS_URL)) {
    const redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      await redis.ping();
    } catch (e) {
      problems.push(`Cannot connect to REDIS_URL: ${(e as Error).message}`);
    } finally {
      await redis.disconnect().catch(() => undefined);
    }
  }

  if (problems.length) {
    console.error('Configuration problems:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`Configuration OK (NODE_ENV=${process.env.NODE_ENV || 'development'}).`);
}

main();
