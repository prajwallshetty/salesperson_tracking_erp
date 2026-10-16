import { describe, it, expect, beforeAll } from 'vitest';
import { api, login, uid, type Session } from './helpers';

describe('expense claims workflow', () => {
  let admin: Session, manager: Session, rahul: Session, vishal: Session;
  beforeAll(async () => {
    [admin, manager, rahul, vishal] = await Promise.all(['admin@erp.com', 'manager@erp.com', 'rahul@erp.com', 'vishal@erp.com'].map((e) => login(e)));
  });

  const newClaim = (s: Session, status: 'DRAFT' | 'SUBMITTED' = 'DRAFT') =>
    api('/api/expenses', {
      token: s.token,
      body: { category: 'FUEL', amount: 375.5, expenseDate: new Date().toISOString(), description: `Fuel ${uid()}`, paymentMethod: 'UPI', status },
    });

  it('draft → submit → approve → reimburse with full history', async () => {
    const d = await newClaim(rahul);
    expect(d.status).toBe(201);
    expect(d.json.data.status).toBe('DRAFT');
    expect(d.json.data.amount).toBe(375.5);
    expect(d.json.data.expenseNumber).toMatch(/^EXP-\d{4}-\d{6}$/);
    const id = d.json.data.id;

    expect((await api(`/api/expenses/${id}/approve`, { token: manager.token, body: {} })).status).toBe(400); // not submitted yet
    expect((await api(`/api/expenses/${id}/submit`, { token: rahul.token, body: {} })).json.data.status).toBe('SUBMITTED');
    expect((await api(`/api/expenses/${id}`, { method: 'PUT', token: rahul.token, body: { amount: 1 } })).status).toBe(400); // locked
    expect((await api(`/api/expenses/${id}/reimburse`, { token: admin.token, body: { reimbursementRef: 'R1', reimbursementMethod: 'UPI' } })).status).toBe(400);

    const ap = await api(`/api/expenses/${id}/approve`, { token: manager.token, body: { comment: 'ok' } });
    expect(ap.json.data.status).toBe('APPROVED');
    expect((await api(`/api/expenses/${id}/approve`, { token: admin.token, body: {} })).status).toBe(400); // no double approval

    const rb = await api(`/api/expenses/${id}/reimburse`, { token: admin.token, body: { reimbursementRef: 'NEFT-778', reimbursementMethod: 'Bank Transfer' } });
    expect(rb.json.data.status).toBe('REIMBURSED');

    const detail = await api(`/api/expenses/${id}`, { token: rahul.token });
    expect(detail.json.data.history.map((h: any) => h.action)).toEqual(['REIMBURSED', 'APPROVED', 'SUBMITTED', 'CREATED_DRAFT']);
  });

  it('rejection requires a reason; rejected claims can be edited and resubmitted', async () => {
    const s = await newClaim(rahul, 'SUBMITTED');
    const id = s.json.data.id;
    expect((await api(`/api/expenses/${id}/reject`, { token: manager.token, body: {} })).status).toBe(400);
    const rj = await api(`/api/expenses/${id}/reject`, { token: manager.token, body: { rejectionReason: 'Attach bill' } });
    expect(rj.json.data.status).toBe('REJECTED');
    expect((await api(`/api/expenses/${id}`, { method: 'PUT', token: rahul.token, body: { amount: 400, receiptUrl: '/api/files/x.png' } })).status).toBe(200);
    const re = await api(`/api/expenses/${id}/submit`, { token: rahul.token, body: {} });
    expect(re.json.data.status).toBe('SUBMITTED');
    expect(re.json.data.rejectionReason).toBeNull();
    expect(re.json.data.amount).toBe(400);
  });

  it('manager cannot review or reimburse claims outside their team', async () => {
    const s = await newClaim(vishal, 'SUBMITTED');
    const id = s.json.data.id;
    expect((await api(`/api/expenses/${id}/approve`, { token: manager.token, body: {} })).status).toBe(403);
    expect((await api(`/api/expenses/${id}`, { token: manager.token })).status).toBe(403);
    expect((await api(`/api/expenses?salespersonId=${vishal.user.salespersonId}`, { token: manager.token })).status).toBe(403);
    await api(`/api/expenses/${id}/approve`, { token: admin.token, body: {} });
    expect((await api(`/api/expenses/${id}/reimburse`, { token: manager.token, body: { reimbursementRef: 'R', reimbursementMethod: 'Cash' } })).status).toBe(403);
  });

  it('salesperson cannot see or edit another salesperson’s claim', async () => {
    const s = await newClaim(vishal);
    expect((await api(`/api/expenses/${s.json.data.id}`, { token: rahul.token })).status).toBe(403);
    expect((await api(`/api/expenses/${s.json.data.id}`, { method: 'PUT', token: rahul.token, body: { amount: 1 } })).status).toBe(403);
    const list = await api('/api/expenses?limit=100', { token: rahul.token });
    expect(list.json.data.every((e: any) => e.salespersonId === rahul.user.salespersonId)).toBe(true);
    expect(list.json.summary.SUBMITTED.count).toBeGreaterThanOrEqual(1);
  });

  it('offlineId deduplicates retried submissions', async () => {
    const offlineId = `off-${uid()}`;
    const body = { category: 'FOOD_MEALS', amount: 120, expenseDate: new Date().toISOString(), description: 'Lunch with client', offlineId };
    const a = await api('/api/expenses', { token: rahul.token, body });
    const b = await api('/api/expenses', { token: rahul.token, body });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.data.id).toBe(a.json.data.id);
  });

  it('validates input', async () => {
    const r = await api('/api/expenses', { token: rahul.token, body: { category: 'FUEL', amount: -5, expenseDate: '2026-01-01', description: 'x' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBeTruthy();
    expect((await api('/api/expenses', { token: admin.token, body: { category: 'FUEL', amount: 5, expenseDate: '2026-01-01', description: 'abc' } })).status).toBe(403);
  });
});
