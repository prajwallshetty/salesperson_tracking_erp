import { describe, it, expect } from 'vitest';
import { calculateOrderTotals } from '@/lib/domain/orderCalculator';

describe('calculateOrderTotals', () => {
  it('reproduces the legacy verified example (7,050 / 450 / 1,188 / 7,788)', () => {
    const r = calculateOrderTotals(
      [
        { quantity: 10, unitPrice: 450, taxRate: 18 },
        { quantity: 5, unitPrice: 250, taxRate: 18 },
        { quantity: 2, unitPrice: 650, taxRate: 18 },
      ],
      450
    );
    expect(r).toMatchObject({ subtotal: 7050, discount: 450, taxableAmount: 6600, tax: 1188, grandTotal: 7788 });
    expect(r.items.reduce((s, i) => s + i.total, 0)).toBeCloseTo(7788, 2);
  });

  it('applies item discounts before tax', () => {
    const r = calculateOrderTotals([{ quantity: 2, unitPrice: 1200, discount: 50, taxRate: 18 }]);
    expect(r.subtotal).toBe(2400);
    expect(r.discount).toBe(50);
    expect(r.tax).toBe(423);
    expect(r.grandTotal).toBe(2773);
  });

  it('caps discounts at the taxable amount and never goes negative', () => {
    const r = calculateOrderTotals([{ quantity: 1, unitPrice: 100, taxRate: 18 }], 500);
    expect(r.discount).toBe(100);
    expect(r.grandTotal).toBe(0);
    expect(calculateOrderTotals([{ quantity: -3, unitPrice: 100 }]).grandTotal).toBe(0);
  });

  it('allocates the order discount proportionally across mixed tax rates', () => {
    const r = calculateOrderTotals([
      { quantity: 1, unitPrice: 1000, taxRate: 18 },
      { quantity: 1, unitPrice: 1000, taxRate: 5 },
    ], 200);
    expect(r.items[0].discount).toBe(100);
    expect(r.items[1].discount).toBe(100);
    expect(r.tax).toBe(162 + 45);
    expect(r.grandTotal).toBe(1800 + 207);
  });

  it('defaults tax to 18% and rounds to paise', () => {
    const r = calculateOrderTotals([{ quantity: 3, unitPrice: 33.33 }]);
    expect(r.subtotal).toBe(99.99);
    expect(r.tax).toBe(18);
    expect(r.grandTotal).toBe(117.99);
  });
});
