/**
 * Validates runtime configuration and database connectivity before a deploy/start.
 *   npm run check:env
 * Exits non-zero on any problem. Reads .env files the same way the server does.
 */
import '../src/lib/loadEnv';
import { PrismaClient } from '@prisma/client';
import { validateConfig } from '../src/lib/config';

async function main() {
  const result = validateConfig();
  const problems = [...result.errors];
  if (!process.env.UPLOAD_DIR) problems.push('UPLOAD_DIR is not set (defaults to ./uploads — use persistent storage in production).');

  if (process.env.DATABASE_URL) {
    const prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const pending = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NULL`.catch(() => null);
      if (pending === null) problems.push('Database has no _prisma_migrations table: baseline it with `npm run db:baseline` (existing db) or run `npm run db:migrate` (new db).');
      else if (Number(pending[0].n) > 0) problems.push('A migration is in a failed/unfinished state — inspect `npx prisma migrate status`.');
    } catch (e) {
      problems.push(`Cannot connect to DATABASE_URL: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      await prisma.$disconnect();
    }
  }

  if (problems.length) {
    console.error('Configuration problems:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`Configuration OK (NODE_ENV=${process.env.NODE_ENV || 'development'}).`);
}

main();
