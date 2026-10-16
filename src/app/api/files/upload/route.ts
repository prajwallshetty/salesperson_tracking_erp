import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { authedRoute, json } from '@/lib/http/handler';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: '.webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'application/pdf': { ext: '.pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
};

/** Legacy contract: multipart field `file`; returns `{ url: '/api/files/<name>' }`. */
export const POST = authedRoute({}, async ({ req, user }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return json({ error: 'No file uploaded' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'File too large. Maximum size is 10MB.' }, 413);
  const spec = ALLOWED[file.type];
  if (!spec) return json({ error: 'Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed.' }, 400);

  const buf = Buffer.from(await file.arrayBuffer());
  // Content sniffing: the declared MIME type must match the bytes.
  if (!spec.magic(buf)) return json({ error: 'File content does not match its declared type.' }, 400);

  await fs.mkdir(config.uploadDir, { recursive: true });
  const filename = `file-${Date.now()}-${randomBytes(6).toString('hex')}${spec.ext}`;
  await fs.writeFile(path.join(config.uploadDir, filename), buf);
  // Ownership row: lets the uploader read the file before any record references it.
  await prisma.uploadedFile.create({ data: { filename, uploadedById: user.id, mimeType: file.type, size: buf.length } });

  return json({ message: 'File uploaded successfully', url: `/api/files/${filename}`, filename, size: buf.length, mimetype: file.type });
});
