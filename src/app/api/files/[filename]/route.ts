import { promises as fs } from 'fs';
import path from 'path';
import { authedRoute, json } from '@/lib/http/handler';
import { config } from '@/lib/config';
import { canReadFile } from '@/features/files/access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };

export const GET = authedRoute<{ filename: string }>({}, async ({ params, user }) => {
  const safe = path.basename(params.filename);
  if (!(await canReadFile(user, safe))) return json({ error: 'File not found' }, 404);
  const full = path.join(config.uploadDir, safe);
  try {
    const data = await fs.readFile(full);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': TYPES[path.extname(safe).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${safe}"`,
      },
    });
  } catch {
    return json({ error: 'File not found' }, 404);
  }
});
