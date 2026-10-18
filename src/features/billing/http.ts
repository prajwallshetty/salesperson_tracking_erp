import type { RouteOptions } from '@/lib/http/handler';
import { pagination } from '@/lib/http/request';
import { badRequest } from '@/lib/http/errors';

/** Viewing, drafting and sending documents: administrators, and managers allowed to view payments. */
export const READ_OPTS: RouteOptions = { roles: ['MANAGER'], managerPermission: 'canViewPayments' };
/** Issuing, cancelling, correcting and recording money: administrators, and managers allowed to verify payments. */
export const FINANCE_OPTS: RouteOptions = { roles: ['MANAGER'], managerPermission: 'canVerifyPayments' };
/** Business details and numbering: administrators only. */
export const ADMIN_OPTS: RouteOptions = { roles: [] };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export function parseListQuery(sp: URLSearchParams) {
  const date = (k: string) => {
    const v = sp.get(k);
    if (!v) return undefined;
    if (!YMD.test(v)) throw badRequest(`${k} must be YYYY-MM-DD`);
    return v;
  };
  const clientId = sp.get('clientId') || undefined;
  if (clientId && !UUID.test(clientId)) throw badRequest('Invalid clientId');
  const { limit, offset } = pagination(sp, { limit: 25, max: 200 });
  return {
    q: sp.get('q')?.trim().slice(0, 100) || undefined,
    status: sp.get('status') || undefined,
    from: date('from'),
    to: date('to'),
    clientId,
    sort: sp.get('sort') || undefined,
    dir: sp.get('dir') || undefined,
    includeRevisions: sp.get('includeRevisions') === 'true',
    limit,
    offset,
  };
}

export function pdfResponse(pdf: Buffer, filename: string, download: boolean) {
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename.replace(/[^\w.\-]+/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
