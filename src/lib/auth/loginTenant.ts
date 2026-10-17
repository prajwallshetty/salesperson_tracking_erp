import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma, prismaRoot, type Tenant } from '@/lib/db';
import { hitShared, type RateLimitRule } from '@/lib/http/rateLimit';
import { isTenantUsable } from './session';

/**
 * Company-aware identity resolution for the two sign-in methods.
 *
 *  - The company is chosen by its code (tenant slug), never by an id from the client, and every
 *    later query is scoped to the tenant found here (see runWithTenant in the login routes).
 *  - The same email, phone or employee code may exist in several companies; inside one company an
 *    identifier that matches more than one user is refused rather than guessed.
 *  - Unknown company, unknown user and wrong secret are indistinguishable to the caller.
 */

export const COMPANY_REQUIRED_CODE = 'COMPANY_REQUIRED';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type TenantLookup =
  | { kind: 'found'; tenant: Tenant }
  | { kind: 'unknown' }
  | { kind: 'company_required' };

/** With several companies a code is required; a deployment with exactly one company needs none. */
export async function resolveLoginTenant(company?: string | null): Promise<TenantLookup> {
  const slug = (company ?? '').trim().toLowerCase();
  if (slug) {
    if (!SLUG_RE.test(slug)) return { kind: 'unknown' };
    const tenant = await prismaRoot.tenant.findUnique({ where: { slug } });
    return tenant ? { kind: 'found', tenant } : { kind: 'unknown' };
  }
  const tenants = await prismaRoot.tenant.findMany({ take: 2, orderBy: { createdAt: 'asc' } });
  if (tenants.length === 1) return { kind: 'found', tenant: tenants[0] };
  return tenants.length === 0 ? { kind: 'unknown' } : { kind: 'company_required' };
}

export async function isCompanyCodeRequired(): Promise<boolean> {
  return (await prismaRoot.tenant.count()) > 1;
}

export const companyRequiredResponse = () =>
  NextResponse.json({ error: 'Company code is required', code: COMPANY_REQUIRED_CODE }, { status: 400 });

export const inactiveTenantResponse = () =>
  NextResponse.json({ error: "Your company's SalesGrid subscription is not active. Contact your administrator." }, { status: 403 });

export { isTenantUsable };

/** Per-account throttle on top of the per-IP one (stops a botnet from guessing one account). */
export const IDENTITY_LIMIT: RateLimitRule = {
  name: 'login-identity',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.IDENTITY_RATE_LIMIT_MAX || 20),
  message: 'Too many sign-in attempts for this account. Please try again later.',
};

export async function identityThrottled(tenantId: string, identifier: string): Promise<Response | null> {
  if (process.env.DISABLE_RATE_LIMIT === 'true') return null;
  const r = await hitShared(IDENTITY_LIMIT, `${tenantId}:${identifier.trim().toLowerCase()}`);
  if (r.allowed) return null;
  return NextResponse.json(
    { error: IDENTITY_LIMIT.message },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))) } }
  );
}

// A real bcrypt hash of a random string: compared when no account matches so that "no such
// account" costs the same time as "wrong password".
const DUMMY_HASH = bcrypt.hashSync('salesgrid-timing-equaliser', 10);
export async function burnPasswordCheck(secret: string): Promise<void> {
  await bcrypt.compare(secret, DUMMY_HASH);
}

export type IdentityResult<U> = { kind: 'user'; user: U } | { kind: 'none' } | { kind: 'ambiguous' };

/** Must run inside runWithTenant(): matches email, phone or employee code within the company. */
export async function findUserByIdentifier(identifier: string, opts: { allowEmail?: boolean } = { allowEmail: true }) {
  const id = identifier.trim();
  const or: object[] = [{ phone: id }, { salespersonProfile: { employeeCode: id } }];
  if (opts.allowEmail !== false) or.push({ email: { equals: id, mode: 'insensitive' as const } });
  const users = await prisma.user.findMany({ where: { OR: or }, include: { salespersonProfile: true }, take: 2 });
  if (users.length === 0) return { kind: 'none' } as const;
  if (users.length > 1) return { kind: 'ambiguous' } as const;
  return { kind: 'user', user: users[0] } as const;
}
