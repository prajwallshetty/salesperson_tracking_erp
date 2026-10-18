export const inr = (n: number | string | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 2026-10-18 or a full ISO timestamp → 18-10-2026. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { timeZone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

/** Today in the business timezone as YYYY-MM-DD (matches what the server uses for defaults). */
export function todayYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata' });
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED'];
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
];

export const methodLabel = (m: string) => PAYMENT_METHODS.find((p) => p.value === m)?.label ?? m;

/** Human wording for audit-log actions shown in a document's history. */
export const ACTION_LABELS: Record<string, string> = {
  CREATE_QUOTATION: 'Created',
  UPDATE_QUOTATION: 'Edited',
  DELETE_QUOTATION: 'Deleted',
  SEND_QUOTATION: 'Marked as sent',
  ACCEPTED_QUOTATION: 'Accepted',
  REJECTED_QUOTATION: 'Rejected',
  REVISE_QUOTATION: 'Revised',
  DUPLICATE_QUOTATION: 'Duplicated',
  CONVERT_QUOTATION: 'Converted to invoice',
  EXPIRE_QUOTATIONS: 'Expired',
  CREATE_INVOICE: 'Created',
  UPDATE_INVOICE: 'Edited',
  ISSUE_INVOICE: 'Issued',
  CANCEL_INVOICE: 'Cancelled',
  CORRECT_INVOICE: 'Corrected (copy opened)',
  PAYMENT_RECORDED: 'Payment recorded',
  PAYMENT_VOIDED: 'Payment voided',
  RECORD_INVOICE_PAYMENT: 'Payment recorded',
  VOID_INVOICE_PAYMENT: 'Payment voided',
};

export function statusTone(status: string): string {
  return status;
}

/** Digits only, for wa.me links (India country code added to 10-digit numbers). */
export function whatsappNumber(phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}
