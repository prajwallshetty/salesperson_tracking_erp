import { describe, it, expect, beforeAll } from 'vitest';
import { api, login, type Session } from './helpers';

describe('reports & exports', () => {
  let admin: Session;
  beforeAll(async () => {
    admin = await login('admin@erp.com');
  });

  const headers: Record<string, string> = {
    sales: 'Order Number,Date,Salesperson,Client,City,Subtotal,Discount,Tax,Grand Total,Status',
    collections: 'Receipt Number,Date,Salesperson,Client,Order Number,Amount,Payment Mode,Status,Verified By',
    attendance: 'Salesperson,Code,Territory,Date,Login Time,Logout Time,Work Minutes,Distance (KM),Status',
    visits: 'Salesperson,Client,City,Visit Date,Start Time,End Time,Distance (m),Exception?,Outcome,Notes',
    'product-sales': 'Product SKU,Product Name,Category,Quantity Sold,Revenue (INR)',
  };

  for (const type of Object.keys(headers)) {
    it(`${type}: JSON and CSV export`, async () => {
      const j = await api(`/api/reports/${type}`, { token: admin.token });
      expect(j.status).toBe(200);
      expect(Array.isArray(j.json.data)).toBe(true);
      const c = await api(`/api/reports/${type}?format=csv`, { token: admin.token });
      expect(c.status).toBe(200);
      expect(c.headers.get('content-type')).toContain('text/csv');
      expect(c.headers.get('content-disposition')).toMatch(/attachment; filename=".+\.csv"/);
      expect(c.text.split('\n')[0]).toBe(headers[type]);
    });
  }

  it('sales summary equals the sum of rows', async () => {
    const r = await api('/api/reports/sales', { token: admin.token });
    const sum = r.json.data.reduce((s: number, o: any) => s + o.grandTotal, 0);
    expect(r.json.summary.totalSales).toBeCloseTo(sum, 2);
    expect(r.json.summary.totalOrders).toBe(r.json.data.length);
  });

  it('date filters narrow results', async () => {
    const r = await api('/api/reports/sales?from=2000-01-01&to=2000-01-02', { token: admin.token });
    expect(r.json.data).toEqual([]);
  });

  it('product-sales is scoped for salespersons (legacy returned company-wide figures)', async () => {
    const rahul = await login('rahul@erp.com');
    const mine = await api('/api/reports/product-sales', { token: rahul.token });
    const all = await api('/api/reports/product-sales', { token: admin.token });
    const total = (rows: any[]) => rows.reduce((s, r) => s + r.revenue, 0);
    expect(total(mine.json.data)).toBeLessThanOrEqual(total(all.json.data));
  });

  it('unknown report types are 404', async () => {
    expect((await api('/api/reports/unknown', { token: admin.token })).status).toBe(404);
  });
});
