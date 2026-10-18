import { prisma, TxClient } from '@/lib/db';
import { businessProfileSchema } from './schemas';
import { logAuditEvent, type AuditActor } from '@/lib/services/audit';

type Db = TxClient | typeof prisma;

export interface BusinessDetails {
  displayName: string;
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  gstin?: string | null;
  pan?: string | null;
  gstEnabled: boolean;
  defaultTaxRate: number;
  roundTotal: boolean;
  currency: string;
  quotationValidityDays: number;
  invoiceDueDays: number;
  defaultPaymentTerms?: string | null;
  quotationNotes?: string | null;
  quotationTerms?: string | null;
  invoiceNotes?: string | null;
  invoiceTerms?: string | null;
  bankAccountName?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankBranch?: string | null;
  upiId?: string | null;
  paymentInstructions?: string | null;
  signatoryLabel?: string | null;
}

/** Built-in defaults: only the brand name and numeric defaults. No address, GSTIN, bank or phone is ever invented. */
export const DEFAULT_BUSINESS: BusinessDetails = {
  displayName: 'Bharath Interior Decor',
  gstEnabled: false,
  defaultTaxRate: 18,
  roundTotal: true,
  currency: 'INR',
  quotationValidityDays: 15,
  invoiceDueDays: 15,
};

function toDetails(row: Record<string, any>): BusinessDetails {
  const { id: _id, tenantId: _t, updatedAt: _u, ...rest } = row;
  return { ...rest, defaultTaxRate: Number(rest.defaultTaxRate) } as BusinessDetails;
}

export async function getBusinessProfile(db: Db = prisma): Promise<BusinessDetails & { configured: boolean }> {
  const row = await db.businessProfile.findFirst();
  return row ? { ...toDetails(row), configured: true } : { ...DEFAULT_BUSINESS, configured: false };
}

/** The business details to print on a document: the frozen copy once the document is sent/issued, else the live settings. */
export function businessForDocument(snapshot: unknown, live: BusinessDetails): BusinessDetails {
  return snapshot && typeof snapshot === 'object' ? ({ ...DEFAULT_BUSINESS, ...(snapshot as BusinessDetails) }) : live;
}

export async function snapshotBusiness(db: Db = prisma): Promise<BusinessDetails> {
  const { configured: _c, ...details } = await getBusinessProfile(db);
  return JSON.parse(JSON.stringify(details));
}

export async function saveBusinessProfile(rawInput: unknown, actor: AuditActor) {
  const input = businessProfileSchema.parse(rawInput);
  const data = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === undefined ? null : v])) as Record<string, any>;
  data.displayName = input.displayName;
  const before = await getBusinessProfile();
  const existing = await prisma.businessProfile.findFirst({ select: { id: true } });
  if (existing) await prisma.businessProfile.update({ where: { id: existing.id }, data });
  else await prisma.businessProfile.create({ data: data as any });
  await logAuditEvent({ actor, action: 'UPDATE_BUSINESS_PROFILE', module: 'BILLING_SETTINGS', oldValue: before, newValue: input });
  return getBusinessProfile();
}
