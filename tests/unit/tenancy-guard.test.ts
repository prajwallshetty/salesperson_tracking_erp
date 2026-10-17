import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * `prismaRoot` bypasses tenant scoping. It may only be imported by the files below; anything else
 * must use the scoped `prisma`. Adding a file here is a security review decision.
 */
const ALLOWED = new Set([
  'src/lib/db/index.ts', // defines it
  'src/lib/auth/session.ts', // loads the user (and so the tenant) from a signed token
  'src/lib/auth/loginTenant.ts', // resolves the company at sign-in
  'src/app/api/auth/dev-login/route.ts', // development-only, disabled in production
  'src/features/files/access.ts', // "is this file owned by any company?" for legacy uploads
  'src/lib/tenants/admin.ts', // tenant administration (CLI)
  'src/lib/jobs/retention.ts', // maintenance job across companies
]);

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('unscoped Prisma client allow-list', () => {
  const root = process.cwd();
  const files = walk(path.join(root, 'src')).map((f) => path.relative(root, f).split(path.sep).join('/'));

  it('prismaRoot is imported only by reviewed files', () => {
    const users = files.filter((f) => /\bprismaRoot\b/.test(stripComments(readFileSync(path.join(root, f), 'utf8'))));
    const unexpected = users.filter((f) => !ALLOWED.has(f));
    expect(unexpected).toEqual([]);
  });

  it('no application code constructs its own PrismaClient', () => {
    const offenders = files.filter((f) => f !== 'src/lib/db/index.ts' && /new PrismaClient\(/.test(readFileSync(path.join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every Route Handler that touches data runs through authedRoute or an explicitly public route', () => {
    const routes = files.filter((f) => f.startsWith('src/app/api/') && f.endsWith('/route.ts'));
    const bare = routes.filter((f) => {
      const src = readFileSync(path.join(root, f), 'utf8');
      const usesData = /from '@\/lib\/db'/.test(src) && /\bprisma\./.test(src);
      return usesData && !/authedRoute|publicRoute/.test(src);
    });
    // logout authenticates by hand (tested); health is public and only runs a raw `SELECT 1`.
    expect(bare.filter((f) => !f.endsWith('auth/logout/route.ts') && !f.endsWith('api/health/route.ts'))).toEqual([]);
  });
});
