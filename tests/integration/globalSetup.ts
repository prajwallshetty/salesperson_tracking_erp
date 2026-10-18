import { spawn, execSync, type ChildProcess } from 'child_process';

/**
 * Starts the real SalesGrid server (Next.js + Socket.IO) against a disposable test database,
 * migrated with the production migration files and loaded with the dev seed.
 * Skipped when only unit tests run (no TEST_DATABASE_URL and SKIP_INTEGRATION=1).
 */
let server: ChildProcess | undefined;

export async function setup() {
  if (process.env.SKIP_INTEGRATION === '1') return;
  const dbUrl = process.env.TEST_DATABASE_URL || 'postgresql://salesgrid:salesgrid@localhost:5432/salesgrid_test?schema=public';
  const dbName = new URL(dbUrl).pathname.slice(1);
  if (!/_test$/.test(dbName)) throw new Error(`Refusing to run integration tests against non-test database "${dbName}"`);

  const port = process.env.TEST_PORT || '3100';
  process.env.TEST_BASE_URL = `http://localhost:${port}`;
  const env = {
    ...process.env,
    DATABASE_URL: dbUrl,
    JWT_SECRET: 'integration-test-secret-0123456789-abcdefghijklmnop',
    PORT: port,
    UPLOAD_DIR: './.test-uploads',
    DISABLE_RATE_LIMIT: 'true',
    NODE_ENV: process.env.TEST_SERVER_MODE === 'production' ? 'production' : 'development',
    COOKIE_SECURE: 'false',
    DEV_QUICK_LOGIN: 'true',
    SEED_SECOND_TENANT: 'true',
  } as NodeJS.ProcessEnv;

  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });

  // Windows cannot spawn npx directly and has no process groups; elsewhere the server gets its own group so teardown can stop it.
  const win = process.platform === 'win32';
  const child = win
    ? spawn('npx tsx server.ts', { env, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    : spawn('npx', ['tsx', 'server.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  server = child;
  child.stdout?.on('data', (d) => process.env.DEBUG_SERVER && process.stdout.write(d));
  child.stderr?.on('data', (d) => process.env.DEBUG_SERVER && process.stderr.write(d));

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${process.env.TEST_BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('SalesGrid test server did not become healthy');
}

export async function teardown() {
  if (server?.pid) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
      else process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already exited */
    }
  }
}
