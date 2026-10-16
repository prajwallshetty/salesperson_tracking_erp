'use client';

import { apiFetch, errorMessage } from './apiFetch';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

/** Uploads a receipt/proof file to /api/files/upload and returns its URL. */
export async function uploadFile(file: File): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED.includes(file.type)) return { error: 'Only JPEG, PNG, WEBP or PDF files can be attached.' };
  if (file.size > MAX_BYTES) return { error: 'File is larger than 10 MB.' };
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await apiFetch('/api/files/upload', { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || `Upload failed (HTTP ${res.status})` };
    return { url: body.url };
  } catch (err) {
    return { error: errorMessage(err, 'Upload failed') };
  }
}
