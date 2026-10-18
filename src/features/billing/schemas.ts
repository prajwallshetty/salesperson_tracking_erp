import { z } from 'zod';

const blankToUndef = (v: unknown) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : typeof v === 'string' ? v.trim() : v);
/** Blank or null → undefined (not provided); otherwise trimmed upper case, for identifiers such as GSTIN, PAN and IFSC. */
const upperOrUndef = (v: unknown) => (v === null ? undefined : typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toUpperCase()) : v);
const optText = (max: number) => z.preprocess(blankToUndef, z.string().max(max).optional());
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const money = z.number().finite().min(0).max(999_999_999);

/** 15-character GSTIN structure (state code, PAN, entity, Z, check character). The check digit is not verified. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const gstin = z.preprocess(upperOrUndef, z.string().regex(GSTIN_PATTERN, 'Enter a valid 15-character GSTIN').optional());

export const lineSchema = z.object({
  productId: z.preprocess(blankToUndef, z.string().uuid().optional()),
  description: z.string().trim().min(1, 'Describe the item').max(500),
  hsn: optText(16),
  quantity: z.number().finite().gt(0, 'Quantity must be more than 0').max(10_000_000),
  unit: z.preprocess(blankToUndef, z.string().max(16).default('PCS')),
  rate: money,
  discountType: z.enum(['PERCENT', 'AMOUNT']).default('PERCENT'),
  discountValue: z.number().finite().min(0).max(999_999_999).default(0),
  taxRate: z.number().finite().min(0).max(100).optional(),
});

const documentFields = {
  clientId: z.preprocess(blankToUndef, z.string().uuid().optional()),
  customerName: z.string().trim().min(1, 'Customer name is required').max(200),
  customerPhone: optText(30),
  customerEmail: z.preprocess(blankToUndef, z.string().email('Enter a valid email').max(200).optional()),
  customerAddress: optText(500),
  customerGstin: gstin,
  customerState: optText(80),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(200),
  discountType: z.enum(['PERCENT', 'AMOUNT']).default('AMOUNT'),
  discountValue: z.number().finite().min(0).max(999_999_999).default(0),
  shippingCharge: money.default(0),
  otherCharges: money.default(0),
  chargesTaxRate: z.number().finite().min(0).max(100).optional(),
  /** NONE = non-GST document. Ignored (forced to NONE) while the business has not enabled GST. */
  taxMode: z.enum(['NONE', 'INTRA', 'INTER']).optional(),
  paymentTerms: optText(500),
  notes: optText(2000),
  terms: optText(5000),
};

export const quotationInputSchema = z.object({
  ...documentFields,
  quotationDate: ymd.optional(),
  validUntil: ymd.optional(),
});

export const invoiceInputSchema = z.object({
  ...documentFields,
  invoiceDate: ymd.optional(),
  dueDate: ymd.optional(),
});

export type DocumentLineInput = z.infer<typeof lineSchema>;
export type QuotationInput = z.infer<typeof quotationInputSchema>;
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500) });

export const quotationResponseSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  reason: optText(500),
});

export const recordPaymentSchema = z.object({
  amount: z.number().finite().gt(0, 'Amount must be more than 0').max(999_999_999),
  paidOn: ymd.optional(),
  method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER']),
  reference: optText(120),
  notes: optText(500),
  /** Generated once per payment form; the same key never records a second payment. */
  idempotencyKey: z.string().trim().min(8).max(100),
});

export const businessProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(150),
  legalName: optText(200),
  address: optText(500),
  city: optText(80),
  state: optText(80),
  pincode: optText(12),
  phone: optText(30),
  email: z.preprocess(blankToUndef, z.string().email().max(200).optional()),
  website: optText(200),
  gstin,
  pan: z.preprocess(upperOrUndef, z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid 10-character PAN').optional()),
  gstEnabled: z.boolean(),
  defaultTaxRate: z.number().finite().min(0).max(100),
  roundTotal: z.boolean(),
  quotationValidityDays: z.number().int().min(1).max(365),
  invoiceDueDays: z.number().int().min(0).max(365),
  defaultPaymentTerms: optText(500),
  quotationNotes: optText(2000),
  quotationTerms: optText(5000),
  invoiceNotes: optText(2000),
  invoiceTerms: optText(5000),
  bankAccountName: optText(150),
  bankName: optText(150),
  bankAccountNumber: optText(40),
  bankIfsc: z.preprocess(upperOrUndef, z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character IFSC').optional()),
  bankBranch: optText(150),
  upiId: optText(100),
  paymentInstructions: optText(1000),
  signatoryLabel: optText(100),
});

export const sequenceSchema = z.object({
  kind: z.enum(['QUOTATION', 'INVOICE', 'RECEIPT']),
  prefix: z.string().trim().max(20).regex(/^[A-Za-z0-9/_-]*$/, 'Use letters, digits, / - _ only'),
  padding: z.number().int().min(1).max(10),
  yearMode: z.enum(['NONE', 'CALENDAR', 'FISCAL']),
  nextNumber: z.number().int().min(1).max(999_999_999),
});
