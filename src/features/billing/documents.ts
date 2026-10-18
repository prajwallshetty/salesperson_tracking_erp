import { calculateDocument, resolveTaxMode, type CalcInput, type TaxMode } from '@/lib/domain/documentCalc';
import { businessDateString } from '@/lib/time';
import { getAccessibleClient } from '@/lib/services/access';
import type { AuthenticatedUser } from '@/lib/permissions';
import type { BusinessDetails } from './business';
import type { DocumentLineInput } from './schemas';

export const ymdToDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
export const dateToYmd = (d: Date) => d.toISOString().slice(0, 10);
export const todayYmd = () => businessDateString();

export function addDays(ymd: string, days: number): string {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToYmd(d);
}

/** Fields shared by quotation and invoice drafts (what the editor submits). */
export interface DocumentDraftInput {
  clientId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  customerGstin?: string;
  customerState?: string;
  lines: DocumentLineInput[];
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: number;
  shippingCharge: number;
  otherCharges: number;
  chargesTaxRate?: number;
  taxMode?: TaxMode;
  paymentTerms?: string;
  notes?: string;
  terms?: string;
}

/** Links an existing client (checking the user may see it) and fills blank customer fields from it. */
export async function resolveCustomer(user: AuthenticatedUser, input: DocumentDraftInput) {
  const base = {
    clientId: input.clientId ?? null,
    customerName: input.customerName,
    customerPhone: input.customerPhone ?? null,
    customerEmail: input.customerEmail ?? null,
    customerAddress: input.customerAddress ?? null,
    customerGstin: input.customerGstin ?? null,
    customerState: input.customerState ?? null,
  };
  if (!input.clientId) return base;
  const client = await getAccessibleClient(user, input.clientId);
  return {
    ...base,
    customerPhone: base.customerPhone ?? client.phone,
    customerEmail: base.customerEmail ?? client.email ?? null,
    customerAddress: base.customerAddress ?? [client.address, client.city, client.pincode].filter(Boolean).join(', '),
    customerGstin: base.customerGstin ?? client.gstNumber ?? null,
    customerState: base.customerState ?? client.state ?? null,
  };
}

export interface ComputedDocument {
  taxMode: TaxMode;
  header: {
    taxMode: TaxMode;
    subtotal: number;
    discountType: 'PERCENT' | 'AMOUNT';
    discountValue: number;
    discountAmount: number;
    shippingCharge: number;
    otherCharges: number;
    chargesTaxRate: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    taxAmount: number;
    roundOff: number;
    grandTotal: number;
  };
  items: {
    position: number;
    productId: string | null;
    description: string;
    hsn: string | null;
    quantity: number;
    unit: string;
    rate: number;
    discountType: 'PERCENT' | 'AMOUNT';
    discountValue: number;
    discountAmount: number;
    taxableAmount: number;
    taxRate: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    lineTotal: number;
  }[];
}

/**
 * Computes every saved figure of a document from its raw inputs. GST is only charged when the
 * business has enabled it; a document can still be made non-GST by choosing tax mode NONE.
 */
export function computeDocument(input: DocumentDraftInput, profile: Pick<BusinessDetails, 'gstEnabled' | 'state' | 'defaultTaxRate' | 'roundTotal'>, customerState?: string | null): ComputedDocument {
  const taxMode: TaxMode = !profile.gstEnabled
    ? 'NONE'
    : input.taxMode ?? resolveTaxMode({ gstEnabled: true, businessState: profile.state, customerState: customerState ?? input.customerState });

  const chargesTaxRate = taxMode === 'NONE' ? 0 : input.chargesTaxRate ?? profile.defaultTaxRate;
  const calcInput: CalcInput = {
    taxMode,
    roundTotal: profile.roundTotal,
    discountType: input.discountType,
    discountValue: input.discountValue,
    shippingCharge: input.shippingCharge,
    otherCharges: input.otherCharges,
    chargesTaxRate,
    lines: input.lines.map((l) => ({
      quantity: l.quantity,
      rate: l.rate,
      discountType: l.discountType,
      discountValue: l.discountValue,
      taxRate: l.taxRate ?? profile.defaultTaxRate,
    })),
  };
  const calc = calculateDocument(calcInput);

  return {
    taxMode,
    header: {
      taxMode,
      subtotal: calc.subtotal,
      discountType: input.discountType,
      discountValue: input.discountValue,
      discountAmount: calc.discountAmount,
      shippingCharge: calc.shippingCharge,
      otherCharges: calc.otherCharges,
      chargesTaxRate,
      taxableAmount: calc.taxableAmount,
      cgstAmount: calc.cgstAmount,
      sgstAmount: calc.sgstAmount,
      igstAmount: calc.igstAmount,
      taxAmount: calc.taxAmount,
      roundOff: calc.roundOff,
      grandTotal: calc.grandTotal,
    },
    items: input.lines.map((l, i) => ({
      position: i,
      productId: l.productId ?? null,
      description: l.description,
      hsn: l.hsn ?? null,
      quantity: l.quantity,
      unit: l.unit ?? 'PCS',
      rate: l.rate,
      discountType: l.discountType,
      discountValue: l.discountValue,
      discountAmount: calc.lines[i].discountAmount,
      taxableAmount: calc.lines[i].taxableAmount,
      taxRate: calc.lines[i].taxRate,
      cgstAmount: calc.lines[i].cgstAmount,
      sgstAmount: calc.lines[i].sgstAmount,
      igstAmount: calc.lines[i].igstAmount,
      lineTotal: calc.lines[i].lineTotal,
    })),
  };
}

type StoredItem = {
  productId: string | null;
  description: string;
  hsn: string | null;
  quantity: unknown;
  unit: string;
  rate: unknown;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: unknown;
  taxRate: unknown;
};

/** A stored document back into editor inputs (used to recompute at issue time and to copy documents). */
export function draftFromStored(doc: Record<string, any> & { items: StoredItem[] }): DocumentDraftInput {
  return {
    clientId: doc.clientId ?? undefined,
    customerName: doc.customerName,
    customerPhone: doc.customerPhone ?? undefined,
    customerEmail: doc.customerEmail ?? undefined,
    customerAddress: doc.customerAddress ?? undefined,
    customerGstin: doc.customerGstin ?? undefined,
    customerState: doc.customerState ?? undefined,
    discountType: doc.discountType,
    discountValue: Number(doc.discountValue),
    shippingCharge: Number(doc.shippingCharge),
    otherCharges: Number(doc.otherCharges),
    chargesTaxRate: Number(doc.chargesTaxRate),
    taxMode: doc.taxMode,
    paymentTerms: doc.paymentTerms ?? undefined,
    notes: doc.notes ?? undefined,
    terms: doc.terms ?? undefined,
    lines: [...doc.items]
      .sort((a: any, b: any) => a.position - b.position)
      .map((i) => ({
        productId: i.productId ?? undefined,
        description: i.description,
        hsn: i.hsn ?? undefined,
        quantity: Number(i.quantity),
        unit: i.unit,
        rate: Number(i.rate),
        discountType: i.discountType,
        discountValue: Number(i.discountValue),
        taxRate: Number(i.taxRate),
      })),
  };
}
