import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { api, login, uid, type Session } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

describe('file uploads', () => {
  let rahul: Session;
  beforeAll(async () => {
    rahul = await login('rahul@erp.com');
  });

  it('uploads a real image and serves it to authenticated users only', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt.png');
    const r = await api('/api/files/upload', { token: rahul.token, body: fd });
    expect(r.status).toBe(200);
    expect(r.json.url).toMatch(/^\/api\/files\/file-\d+-[0-9a-f]+\.png$/);
    const got = await api(r.json.url, { token: rahul.token });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect((await api(r.json.url)).status).toBe(401);
  });

  it('rejects disguised and disallowed files', async () => {
    const fake = new FormData();
    fake.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
    expect((await api('/api/files/upload', { token: rahul.token, body: fake })).status).toBe(400);
    const html = new FormData();
    html.append('file', new Blob(['<html>'], { type: 'text/html' }), 'x.html');
    expect((await api('/api/files/upload', { token: rahul.token, body: html })).status).toBe(400);
    expect((await api('/api/files/upload', { token: rahul.token, body: new FormData() })).status).toBe(400);
  });

  it('does not allow path traversal', async () => {
    expect((await api('/api/files/..%2F..%2Fpackage.json', { token: rahul.token })).status).toBe(404);
  });
});

describe('per-record file authorization', () => {
  let admin: Session, manager: Session, rahul: Session, ahmed: Session, vishal: Session;
  beforeAll(async () => {
    [admin, manager, rahul, ahmed, vishal] = await Promise.all(
      ['admin@erp.com', 'manager@erp.com', 'rahul@erp.com', 'ahmed@erp.com', 'vishal@erp.com'].map((u) => login(u))
    );
  });

  const upload = async (s: Session) => {
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt.png');
    const r = await api('/api/files/upload', { token: s.token, body: fd });
    expect(r.status).toBe(200);
    return r.json.url as string;
  };
  const read = (url: string, s: Session) => api(url, { token: s.token }).then((r) => r.status);

  it('an unattached upload is visible only to its uploader and super admins', async () => {
    const url = await upload(rahul);
    expect(await read(url, rahul)).toBe(200);
    expect(await read(url, admin)).toBe(200);
    expect(await read(url, ahmed)).toBe(404);
    expect(await read(url, manager)).toBe(404);
  });

  it('once attached to an expense, the owner’s manager can read it; other salespersons still cannot', async () => {
    const url = await upload(rahul);
    const e = await api('/api/expenses', {
      token: rahul.token,
      body: { category: 'FUEL', amount: 120, expenseDate: new Date().toISOString(), description: `Receipt ${uid()}`, paymentMethod: 'CASH', receiptUrl: url },
    });
    expect(e.status).toBe(201);
    expect(e.json.data.receiptUrl).toBe(url);
    expect(await read(url, manager)).toBe(200); // Rahul is on this manager's team
    expect(await read(url, ahmed)).toBe(404);
    expect(await read(url, vishal)).toBe(404);
  });

  it('files from before ownership tracking are readable through their record only', async () => {
    const name = `file-${Date.now()}-legacy0001.png`;
    await fs.mkdir('.test-uploads', { recursive: true });
    await fs.writeFile(path.join('.test-uploads', name), PNG);
    const url = `/api/files/${name}`;
    expect(await read(url, admin)).toBe(200);
    expect(await read(url, rahul)).toBe(404);
  });
});
