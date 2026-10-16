export interface OrderItemCalculationInput {
  quantity: number;
  unitPrice: number;
  discount?: number; // item level discount
  taxRate?: number;  // tax rate percentage (e.g. 18.0)
}

export interface CalculatedOrderItem {
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface CalculatedOrder {
  items: CalculatedOrderItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  tax: number;
  grandTotal: number;
}

/**
 * Perform exact decimal arithmetic for order totals.
 * Handles item-level discounts, order-level discount distributed proportionally,
 * GST/tax computation on net taxable values, and grand totals.
 */
export function calculateOrderTotals(
  items: OrderItemCalculationInput[],
  orderLevelDiscount: number = 0
): CalculatedOrder {
  let subtotal = 0;
  let totalItemDiscounts = 0;

  // First pass: line subtotals and item discounts
  const rawItems = items.map((item) => {
    const qty = Math.max(0, item.quantity);
    const price = Math.max(0, item.unitPrice);
    const lineSubtotal = Math.round(qty * price * 100) / 100;
    const itemDiscount = Math.min(lineSubtotal, Math.max(0, item.discount || 0));
    const baseTaxable = Math.round((lineSubtotal - itemDiscount) * 100) / 100;
    const rate = Math.max(0, item.taxRate !== undefined ? item.taxRate : 18.0);

    subtotal += lineSubtotal;
    totalItemDiscounts += itemDiscount;

    return {
      qty,
      price,
      lineSubtotal,
      itemDiscount,
      baseTaxable,
      rate,
    };
  });

  const baseTaxableSum = subtotal - totalItemDiscounts;
  const appliedOrderDiscount = Math.min(baseTaxableSum, Math.max(0, orderLevelDiscount));
  const overallDiscount = Math.round((totalItemDiscounts + appliedOrderDiscount) * 100) / 100;
  const totalTaxable = Math.max(0, Math.round((subtotal - overallDiscount) * 100) / 100);

  let calculatedTax = 0;
  const calculatedItems: CalculatedOrderItem[] = rawItems.map((item) => {
    // Proportional order discount share
    const ratio = baseTaxableSum > 0 ? item.baseTaxable / baseTaxableSum : 0;
    const allocatedOrderDiscount = Math.round(appliedOrderDiscount * ratio * 100) / 100;
    const effectiveTaxable = Math.max(0, Math.round((item.baseTaxable - allocatedOrderDiscount) * 100) / 100);
    const lineTax = Math.round(((effectiveTaxable * item.rate) / 100) * 100) / 100;
    const lineTotal = Math.round((effectiveTaxable + lineTax) * 100) / 100;

    calculatedTax += lineTax;

    return {
      quantity: item.qty,
      unitPrice: item.price,
      subtotal: item.lineSubtotal,
      discount: Math.round((item.itemDiscount + allocatedOrderDiscount) * 100) / 100,
      taxableAmount: effectiveTaxable,
      taxRate: item.rate,
      taxAmount: lineTax,
      total: lineTotal,
    };
  });

  const grandTotal = Math.round((totalTaxable + calculatedTax) * 100) / 100;

  return {
    items: calculatedItems,
    subtotal: Math.round(subtotal * 100) / 100,
    discount: overallDiscount,
    taxableAmount: totalTaxable,
    tax: Math.round(calculatedTax * 100) / 100,
    grandTotal,
  };
}
