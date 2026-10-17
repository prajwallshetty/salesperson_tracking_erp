/**
 * Company (tenant) administration. Run by an operator with database access:
 *
 *   npm run tenant -- list
 *   npm run tenant -- create <code> "<Company name>" --admin-name "<name>" --admin-email <email> --admin-phone <phone> [--admin-password-env VAR] [--active-until 2027-03-31]
 *   npm run tenant -- rename <code> "<New name>"
 *   npm run tenant -- set-code <code> <new-code>
 *   npm run tenant -- suspend <code>        (company users are locked out immediately)
 *   npm run tenant -- activate <code>
 *   npm run tenant -- expiry <code> <YYYY-MM-DD|none>
 *
 * When no admin password is supplied one is generated and printed ONCE.
 */
import '../src/lib/loadEnv';
import { prismaRoot } from '../src/lib/db';
import { changeTenantSlug, createTenant, listTenants, renameTenant, setTenantExpiry, setTenantStatus } from '../src/lib/tenants/admin';

function flags(args: string[]) {
  const out: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) out[args[i].slice(2)] = args[++i] ?? '';
    else rest.push(args[i]);
  }
  return { flags: out, rest };
}

const parseDate = (v: string) => {
  const d = new Date(`${v}T23:59:59.999Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(d.getTime())) throw new Error('Dates use YYYY-MM-DD');
  return d;
};

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { flags: f, rest } = flags(args);
  switch (cmd) {
    case 'list': {
      const rows = await listTenants();
      console.table(rows.map((t) => ({ code: t.slug, name: t.name, status: t.status, activeUntil: t.activeUntil?.toISOString().slice(0, 10) ?? '—', users: t.users, salespersons: t.salespersons })));
      break;
    }
    case 'create': {
      const [slug, name] = rest;
      if (!slug || !name || !f['admin-name'] || !f['admin-email'] || !f['admin-phone']) throw new Error('Usage: create <code> "<name>" --admin-name … --admin-email … --admin-phone …');
      const pw = f['admin-password-env'] ? process.env[f['admin-password-env']] : undefined;
      if (f['admin-password-env'] && !pw) throw new Error(`Environment variable ${f['admin-password-env']} is empty`);
      const r = await createTenant({
        slug, name, adminName: f['admin-name'], adminEmail: f['admin-email'], adminPhone: f['admin-phone'], adminPassword: pw,
        activeUntil: f['active-until'] ? parseDate(f['active-until']) : null,
      });
      console.log(`Created company "${r.tenant.name}" (code: ${r.tenant.slug}).`);
      console.log(`Super admin: ${f['admin-email']}${r.generated ? `   one-time password: ${r.adminPassword}` : ''}`);
      if (r.generated) console.log('Copy the password now; it is not stored anywhere readable.');
      break;
    }
    case 'rename': {
      const t = await renameTenant(rest[0], rest[1] ?? '');
      console.log(`Renamed ${t.slug} to "${t.name}".`);
      break;
    }
    case 'set-code': {
      const t = await changeTenantSlug(rest[0], rest[1] ?? '');
      console.log(`Company code is now "${t.slug}". Tell the company's users to use it at sign-in.`);
      break;
    }
    case 'suspend':
    case 'activate': {
      const t = await setTenantStatus(rest[0], cmd === 'suspend' ? 'SUSPENDED' : 'ACTIVE');
      console.log(`${t.slug}: ${t.status}`);
      break;
    }
    case 'expiry': {
      const t = await setTenantExpiry(rest[0], rest[1] === 'none' ? null : parseDate(rest[1] ?? ''));
      console.log(`${t.slug}: active until ${t.activeUntil?.toISOString().slice(0, 10) ?? 'no expiry'}`);
      break;
    }
    default:
      console.error('Commands: list | create | rename | set-code | suspend | activate | expiry  (see the header of scripts/tenant.ts)');
      process.exit(cmd ? 1 : 0);
  }
}

main()
  .catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  })
  .finally(() => prismaRoot.$disconnect());
