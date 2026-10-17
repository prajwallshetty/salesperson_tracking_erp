import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prismaRoot, prisma, runWithTenant, Role, UserStatus, type Tenant } from '@/lib/db';
import { logAuditEvent } from '@/lib/services/audit';

/**
 * Tenant (company) administration. There is deliberately no platform-wide role or HTTP API for
 * this: companies are created and suspended by an operator with database access, using
 * `npm run tenant -- <command>`. Each company's own SUPER_ADMIN then manages everything inside it.
 */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const RESERVED = new Set(['api', 'admin', 'www', 'root', 'null', 'undefined']);

export const DEFAULT_SETTINGS = [
  { key: 'visit_radius_meters', value: '100', description: 'Maximum radius in meters for genuine client visit without exception note' },
  { key: 'tracking_interval_seconds', value: '60', description: 'GPS location tracking sample interval for on-duty salespersons' },
  { key: 'business_timezone', value: 'Asia/Kolkata', description: 'Default display timezone for business records' },
  { key: 'manager_order_approval_required', value: 'false', description: 'Require manager approval before processing orders' },
  { key: 'cash_verification_required', value: 'true', description: 'Require admin/manager signoff on cash collections' },
];

export function validateSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (!SLUG_RE.test(s) || RESERVED.has(s)) throw new Error('Company code must be 2-63 characters: lowercase letters, digits and hyphens (starting with a letter or digit).');
  return s;
}

export const randomPassword = () => crypto.randomBytes(12).toString('base64url');

export async function listTenants() {
  const tenants = await prismaRoot.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  return Promise.all(
    tenants.map(async (t) => ({
      ...t,
      users: await prismaRoot.user.count({ where: { tenantId: t.id } }),
      salespersons: await prismaRoot.salesperson.count({ where: { tenantId: t.id } }),
    }))
  );
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  /** Plain password for the first super admin; generated (and returned once) when omitted. */
  adminPassword?: string;
  activeUntil?: Date | null;
}

export async function createTenant(input: CreateTenantInput): Promise<{ tenant: Tenant; adminPassword: string; generated: boolean }> {
  const slug = validateSlug(input.slug);
  if (!input.name.trim()) throw new Error('Company name is required');
  if (!/^\S+@\S+\.\S+$/.test(input.adminEmail)) throw new Error('A valid admin email is required');
  if (input.adminPhone.trim().length < 7) throw new Error('A valid admin phone number is required');
  const generated = !input.adminPassword;
  const adminPassword = input.adminPassword ?? randomPassword();
  if (adminPassword.length < 8) throw new Error('Admin password must be at least 8 characters');

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const tenant = await prismaRoot.tenant.create({ data: { slug, name: input.name.trim(), activeUntil: input.activeUntil ?? null } });
  try {
    await runWithTenant(tenant.id, async () => {
      await prisma.user.create({
        data: {
          name: input.adminName.trim(),
          email: input.adminEmail.trim(),
          phone: input.adminPhone.trim(),
          passwordHash,
          role: Role.SUPER_ADMIN,
          status: UserStatus.ACTIVE,
        },
      });
      await prisma.systemSetting.createMany({ data: DEFAULT_SETTINGS });
      await logAuditEvent({ actor: { ip: 'cli' }, action: 'TENANT_CREATED', module: 'TENANT', recordId: tenant.id, newValue: { slug, name: tenant.name } });
    });
  } catch (err) {
    // Leave no half-created company behind.
    await prismaRoot.$transaction([
      prismaRoot.systemSetting.deleteMany({ where: { tenantId: tenant.id } }),
      prismaRoot.auditLog.deleteMany({ where: { tenantId: tenant.id } }),
      prismaRoot.user.deleteMany({ where: { tenantId: tenant.id } }),
      prismaRoot.tenant.delete({ where: { id: tenant.id } }),
    ]);
    throw err;
  }
  return { tenant, adminPassword, generated };
}

async function bySlug(slug: string) {
  const t = await prismaRoot.tenant.findUnique({ where: { slug: slug.trim().toLowerCase() } });
  if (!t) throw new Error(`No company with code "${slug}"`);
  return t;
}

async function audit(t: Tenant, action: string, newValue: unknown) {
  await runWithTenant(t.id, () => logAuditEvent({ actor: { ip: 'cli' }, action, module: 'TENANT', recordId: t.id, newValue }));
}

/** Suspending also signs out every user of the company immediately (their sessions stop validating). */
export async function setTenantStatus(slug: string, status: 'ACTIVE' | 'SUSPENDED') {
  const t = await bySlug(slug);
  const updated = await prismaRoot.tenant.update({ where: { id: t.id }, data: { status } });
  await audit(t, status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : 'TENANT_ACTIVATED', { status });
  return updated;
}

export async function setTenantExpiry(slug: string, activeUntil: Date | null) {
  const t = await bySlug(slug);
  const updated = await prismaRoot.tenant.update({ where: { id: t.id }, data: { activeUntil } });
  await audit(t, 'TENANT_EXPIRY_CHANGED', { activeUntil: activeUntil?.toISOString() ?? null });
  return updated;
}

export async function renameTenant(slug: string, name: string) {
  if (!name.trim()) throw new Error('Company name is required');
  const t = await bySlug(slug);
  const updated = await prismaRoot.tenant.update({ where: { id: t.id }, data: { name: name.trim() } });
  await audit(t, 'TENANT_RENAMED', { name: updated.name });
  return updated;
}

/** Changes the company code used at sign-in (users must be told the new code). */
export async function changeTenantSlug(slug: string, newSlug: string) {
  const t = await bySlug(slug);
  const s = validateSlug(newSlug);
  const updated = await prismaRoot.tenant.update({ where: { id: t.id }, data: { slug: s } });
  await audit(t, 'TENANT_CODE_CHANGED', { from: t.slug, to: s });
  return updated;
}
