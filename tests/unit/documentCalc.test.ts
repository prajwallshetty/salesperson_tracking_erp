import { describe, it, expect } from 'vitest';
import { calculateDocument, resolveTaxMode } from '@/lib/domain/documentCalc';
import { amountInWords } from '@/lib/domain/amountInWords';

describe('calculateDocument', () => {
  it('splits 18% GST into equal CGST and SGST within a state', () => {
    const r = calculateDocument({ taxMode: 'INTRA', lines: [{ quantity: 2, rate: 1000, taxRate: 18 }] });
    expect(r.subtotal).toBe(2000);
    expect(r.cgstAmount).toBe(180);
    expect(r.sgstAmount).toBe(180);
    expect(r.igstAmount).toBe(0);
    expect(r.taxAmount).toBe(360);
    expect(r.grandTotal).toBe(2360);
    expect(r.roundOff).toBe(0);
  });

  it('charges IGST between states', () => {
    const r = calculateDocument({ taxMode: 'INTER', lines: [{ quantity: 1, rate: 500, taxRate: 12 }] });
    expect(r.igstAmount).toBe(60);
    expect(r.cgstAmount + r.sgstAmount).toBe(0);
    expect(r.grandTotal).toBe(560);
  });

  it('charges no tax when GST is off, whatever the line rates say', () => {
    const r = calculateDocument({ taxMode: 'NONE', lines: [{ quantity: 3, rate: 100, taxRate: 18 }], shippingCharge: 50, chargesTaxRate: 18 });
    expect(r.taxAmount).toBe(0);
    expect(r.grandTotal).toBe(350);
  });

  it('applies a percentage line discount before tax and rounds the total to the rupee', () => {
    // 3 × 999.99 = 2999.97; 10% off = 300.00 (299.997 rounded); net 2699.97; GST 18% = 2 × 243.00
    const r = calculateDocument({ taxMode: 'INTRA', lines: [{ quantity: 3, rate: 999.99, discountType: 'PERCENT', discountValue: 10, taxRate: 18 }] });
    expect(r.lines[0].gross).toBe(2999.97);
    expect(r.lines[0].discountAmount).toBe(300);
    expect(r.lines[0].taxableAmount).toBe(2699.97);
    expect(r.cgstAmount).toBe(243);
    expect(r.sgstAmount).toBe(243);
    expect(r.grandTotal).toBe(3186);
    expect(r.roundOff).toBe(0.03);
  });

  it('keeps the exact total when rounding is switched off', () => {
    const r = calculateDocument({ taxMode: 'INTRA', roundTotal: false, lines: [{ quantity: 3, rate: 999.99, discountType: 'PERCENT', discountValue: 10, taxRate: 18 }] });
    expect(r.grandTotal).toBe(3185.97);
    expect(r.roundOff).toBe(0);
  });

  it('caps a fixed line discount at the line value', () => {
    const r = calculateDocument({ taxMode: 'NONE', lines: [{ quantity: 1, rate: 100, discountType: 'AMOUNT', discountValue: 500 }] });
    expect(r.lines[0].taxableAmount).toBe(0);
    expect(r.grandTotal).toBe(0);
  });

  it('spreads the overall discount so the parts add up to the paisa', () => {
    const r = calculateDocument({
      taxMode: 'NONE',
      discountType: 'AMOUNT',
      discountValue: 100,
      lines: [
        { quantity: 1, rate: 100 },
        { quantity: 1, rate: 100 },
        { quantity: 1, rate: 100 },
      ],
    });
    expect(r.discountAmount).toBe(100);
    const taxable = r.lines.map((l) => Math.round(l.taxableAmount * 100));
    expect(taxable.reduce((a, b) => a + b, 0)).toBe(20000);
    expect([...taxable].sort()).toEqual([6666, 6667, 6667]);
    expect(r.grandTotal).toBe(200);
  });

  it('applies a percentage overall discount before tax', () => {
    const r = calculateDocument({ taxMode: 'INTRA', discountType: 'PERCENT', discountValue: 10, lines: [{ quantity: 1, rate: 1000, taxRate: 18 }] });
    expect(r.discountAmount).toBe(100);
    expect(r.taxableAmount).toBe(900);
    expect(r.taxAmount).toBe(162);
    expect(r.grandTotal).toBe(1062);
  });

  it('taxes shipping and other charges at the charges rate and groups tax by slab', () => {
    const r = calculateDocument({
      taxMode: 'INTRA',
      shippingCharge: 100,
      otherCharges: 50,
      chargesTaxRate: 18,
      lines: [
        { quantity: 1, rate: 1000, taxRate: 18 },
        { quantity: 1, rate: 200, taxRate: 5 },
      ],
    });
    expect(r.slabs).toEqual([
      { taxRate: 5, taxableAmount: 200, cgstAmount: 5, sgstAmount: 5, igstAmount: 0 },
      { taxRate: 18, taxableAmount: 1150, cgstAmount: 103.5, sgstAmount: 103.5, igstAmount: 0 },
    ]);
    expect(r.taxableAmount).toBe(1350);
    expect(r.taxAmount).toBe(217);
    expect(r.grandTotal).toBe(1567);
  });

  it('totals equal the sum of the lines (no drift across many lines)', () => {
    const lines = Array.from({ length: 37 }, (_, i) => ({ quantity: 1 + (i % 3) * 0.5, rate: 13.37 + i, taxRate: 18 }));
    const r = calculateDocument({ taxMode: 'INTRA', roundTotal: false, lines });
    const sumLines = Math.round(r.lines.reduce((a, l) => a + l.lineTotal * 100, 0));
    expect(Math.round(r.grandTotal * 100)).toBe(sumLines);
    expect(Math.round((r.cgstAmount + r.sgstAmount) * 100)).toBe(Math.round(r.taxAmount * 100));
  });

  it('handles fractional quantities exactly', () => {
    const r = calculateDocument({ taxMode: 'NONE', lines: [{ quantity: 2.5, rate: 19.99 }] });
    expect(r.lines[0].gross).toBe(49.98); // 49.975 rounded half-up
  });
});

describe('resolveTaxMode', () => {
  it('has no tax unless GST is enabled', () => {
    expect(resolveTaxMode({ gstEnabled: false, businessState: 'Karnataka', customerState: 'Kerala' })).toBe('NONE');
  });
  it('uses CGST/SGST in the same state and IGST otherwise', () => {
    expect(resolveTaxMode({ gstEnabled: true, businessState: 'Karnataka', customerState: ' karnataka ' })).toBe('INTRA');
    expect(resolveTaxMode({ gstEnabled: true, businessState: 'Karnataka', customerState: 'Kerala' })).toBe('INTER');
  });
  it('defaults to CGST/SGST when a state is unknown', () => {
    expect(resolveTaxMode({ gstEnabled: true, businessState: 'Karnataka', customerState: '' })).toBe('INTRA');
  });
});

describe('amountInWords', () => {
  it.each([
    [0, 'Rupees Zero Only'],
    [1, 'Rupees One Only'],
    [19.5, 'Rupees Nineteen and Fifty Paise Only'],
    [100, 'Rupees One Hundred Only'],
    [1234, 'Rupees One Thousand Two Hundred Thirty Four Only'],
    [100000, 'Rupees One Lakh Only'],
    [123456.78, 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only'],
    [10000000, 'Rupees One Crore Only'],
    [250000000, 'Rupees Twenty Five Crore Only'],
  ])('%s', (n, words) => {
    expect(amountInWords(n)).toBe(words);
  });
});
