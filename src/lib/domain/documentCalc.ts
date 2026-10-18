/**
 * Quotation / invoice arithmetic.
 *
 * All money is computed in integer paise (never floating-point rupees) and every rounding step is a
 * half-up rounding of an exact integer division, so the same inputs always give the same totals on
 * the server, in the editor preview and on the PDF.
 *
 * Order of operations (documented in docs/BILLING.md):
 *  1. line gross      = quantity × rate
 *  2. line discount   = percent of gross, or a fixed amount (capped at the gross)
 *  3. overall discount is spread over the lines in proportion to their net value (largest remainder,
 *     so the parts add up exactly), then shipping / other charges are added as taxable lines
 *  4. tax per line    = taxable × rate, rounded to the paisa; CGST and SGST are each half the rate
 *     (rounded separately, so they are always equal), IGST is the full rate
 *  5. grand total     = taxable + tax, optionally rounded to the nearest rupee (round-off shown separately)
 */

export type TaxMode = 'NONE' | 'INTRA' | 'INTER';
export type DiscountType = 'PERCENT' | 'AMOUNT';

export interface CalcLineInput {
  quantity: number;
  rate: number;
  discountType?: DiscountType;
  discountValue?: number;
  taxRate?: number;
}

export interface CalcInput {
  lines: CalcLineInput[];
  discountType?: DiscountType;
  discountValue?: number;
  shippingCharge?: number;
  otherCharges?: number;
  /** GST rate applied to shipping and other charges. */
  chargesTaxRate?: number;
  taxMode: TaxMode;
  roundTotal?: boolean;
}

export interface CalcLineResult {
  gross: number;
  discountAmount: number;
  /** After the line discount and the line's share of the overall discount. */
  taxableAmount: number;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineTotal: number;
}

export interface TaxSlab {
  taxRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}

export interface CalcResult {
  lines: CalcLineResult[];
  /** Sum of line values after line discounts, before the overall discount. */
  subtotal: number;
  discountAmount: number;
  shippingCharge: number;
  otherCharges: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  roundOff: number;
  grandTotal: number;
  slabs: TaxSlab[];
}

const toPaise = (rupees: number) => Math.round((Number.isFinite(rupees) ? rupees : 0) * 100);
const fromPaise = (p: number) => p / 100;
/** Half-up rounded n / d for non-negative integers. */
const divRound = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let remainder = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) out[order[k].i] += 1;
  return out;
}

export function calculateDocument(input: CalcInput): CalcResult {
  const taxMode = input.taxMode;
  const rateBp = (pct?: number) => (taxMode === 'NONE' ? 0 : Math.round((pct ?? 0) * 100));

  // 1–2: line gross and line discount.
  const base = input.lines.map((l) => {
    const qtyMilli = Math.round(l.quantity * 1000);
    const gross = divRound(qtyMilli * toPaise(l.rate), 1000);
    const dv = l.discountValue ?? 0;
    const disc = l.discountType === 'AMOUNT' ? Math.min(gross, toPaise(dv)) : divRound(gross * Math.round(Math.min(Math.max(dv, 0), 100) * 100), 10000);
    return { gross, disc, net: gross - disc, taxBp: rateBp(l.taxRate) };
  });
  const subtotalP = base.reduce((a, l) => a + l.net, 0);

  // 3: overall discount, spread over the lines.
  const od = input.discountValue ?? 0;
  const overallP =
    input.discountType === 'PERCENT'
      ? divRound(subtotalP * Math.round(Math.min(Math.max(od, 0), 100) * 100), 10000)
      : Math.min(subtotalP, toPaise(Math.max(od, 0)));
  const shares = allocate(overallP, base.map((l) => l.net));

  // Charges are taxable lines of their own.
  const shippingP = toPaise(Math.max(input.shippingCharge ?? 0, 0));
  const otherP = toPaise(Math.max(input.otherCharges ?? 0, 0));
  const chargesBp = rateBp(input.chargesTaxRate);

  const taxOf = (taxable: number, bp: number) => {
    if (taxMode === 'NONE' || bp === 0) return { cgst: 0, sgst: 0, igst: 0 };
    if (taxMode === 'INTER') return { cgst: 0, sgst: 0, igst: divRound(taxable * bp, 10000) };
    const half = divRound(taxable * bp, 20000);
    return { cgst: half, sgst: half, igst: 0 };
  };

  const lines: CalcLineResult[] = base.map((l, i) => {
    const taxable = l.net - shares[i];
    const t = taxOf(taxable, l.taxBp);
    return {
      gross: fromPaise(l.gross),
      discountAmount: fromPaise(l.disc),
      taxableAmount: fromPaise(taxable),
      taxRate: l.taxBp / 100,
      cgstAmount: fromPaise(t.cgst),
      sgstAmount: fromPaise(t.sgst),
      igstAmount: fromPaise(t.igst),
      lineTotal: fromPaise(taxable + t.cgst + t.sgst + t.igst),
    };
  });

  // Slab totals (lines + charges), used for the tax summary and the document totals.
  const slabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  const addSlab = (bp: number, taxable: number, t: { cgst: number; sgst: number; igst: number }) => {
    const s = slabMap.get(bp) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    s.taxable += taxable;
    s.cgst += t.cgst;
    s.sgst += t.sgst;
    s.igst += t.igst;
    slabMap.set(bp, s);
  };
  base.forEach((l, i) => {
    const taxable = l.net - shares[i];
    addSlab(l.taxBp, taxable, taxOf(taxable, l.taxBp));
  });
  for (const charge of [shippingP, otherP]) if (charge > 0) addSlab(chargesBp, charge, taxOf(charge, chargesBp));

  const slabs = [...slabMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bp, s]) => ({
      taxRate: bp / 100,
      taxableAmount: fromPaise(s.taxable),
      cgstAmount: fromPaise(s.cgst),
      sgstAmount: fromPaise(s.sgst),
      igstAmount: fromPaise(s.igst),
    }));

  const totals = [...slabMap.values()].reduce(
    (a, s) => ({ taxable: a.taxable + s.taxable, cgst: a.cgst + s.cgst, sgst: a.sgst + s.sgst, igst: a.igst + s.igst }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
  );
  const taxP = totals.cgst + totals.sgst + totals.igst;
  const exactP = totals.taxable + taxP;
  const grandP = input.roundTotal === false ? exactP : divRound(exactP, 100) * 100;

  return {
    lines,
    subtotal: fromPaise(subtotalP),
    discountAmount: fromPaise(overallP),
    shippingCharge: fromPaise(shippingP),
    otherCharges: fromPaise(otherP),
    taxableAmount: fromPaise(totals.taxable),
    cgstAmount: fromPaise(totals.cgst),
    sgstAmount: fromPaise(totals.sgst),
    igstAmount: fromPaise(totals.igst),
    taxAmount: fromPaise(taxP),
    roundOff: fromPaise(grandP - exactP),
    grandTotal: fromPaise(grandP),
    slabs,
  };
}

/** Tax mode for a document: no GST unless the business charges it; CGST+SGST within one state, otherwise IGST. */
export function resolveTaxMode(opts: { gstEnabled: boolean; businessState?: string | null; customerState?: string | null }): TaxMode {
  if (!opts.gstEnabled) return 'NONE';
  const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
  const b = norm(opts.businessState);
  const c = norm(opts.customerState);
  if (!b || !c) return 'INTRA';
  return b === c ? 'INTRA' : 'INTER';
}

/** Rupees as a safe integer number of paise, for comparisons that must not suffer float drift. */
export const rupeesToPaise = toPaise;
export const paiseToRupees = fromPaise;

/** Quantity × rate in rupees, rounded half-up to the paisa (the "gross" of one line, before discounts). */
export function lineGross(quantity: number, rate: number): number {
  return fromPaise(divRound(Math.round(quantity * 1000) * toPaise(rate), 1000));
}
