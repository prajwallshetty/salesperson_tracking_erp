import { execSync } from 'child_process';

/** Fresh, migrated and seeded test database for every E2E run. Refuses non-test databases. */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public';
  const name = new URL(url).pathname.slice(1);
  if (!/_test$/.test(name)) throw new Error(`Refusing to reset non-test database "${name}"`);
  const env = { ...process.env, DATABASE_URL: url } as NodeJS.ProcessEnv;
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });
}
