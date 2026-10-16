import { describe, it, expect, beforeAll } from 'vitest';
import { api, login, type Session } from './helpers';

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
