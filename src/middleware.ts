import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { SESSION_COOKIE } from '@/lib/auth/constants';

/**
 * Page-level gatekeeping only. This is a UX layer (redirects); it is NOT the authorization
 * boundary — every Route Handler re-authenticates against the database and enforces
 * role/permission/scope rules itself.
 */

type Role = 'SUPER_ADMIN' | 'MANAGER' | 'SALESPERSON';

const CONSOLE_PREFIXES = [
  '/dashboard',
  '/salespersons',
  '/clients',
  '/products',
  '/orders',
  '/payments',
  '/expenses',
  '/reports',
  '/settings',
  '/audit-logs',
];
const ADMIN_ONLY_PREFIXES = ['/settings'];
const FIELD_PREFIX = '/field';

const secret = () =>
  new TextEncoder().encode(process.env.JWT_SECRET || 'salesgrid-dev-only-secret-do-not-use-in-production');

async function readRole(req: NextRequest): Promise<Role | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const role = payload.role as Role | undefined;
    return role && ['SUPER_ADMIN', 'MANAGER', 'SALESPERSON'].includes(role) ? role : null;
  } catch {
    return null;
  }
}

const matches = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));
const home = (role: Role) => (role === 'SALESPERSON' ? '/field' : '/dashboard');

function corsHeaders(req: NextRequest): Record<string, string> | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  const allowed = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const devLocal = process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed.includes(origin) && !devLocal) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, X-Device-Id',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    Vary: 'Origin',
  };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: cors ? 204 : 403, headers: cors || {} });
    }
    const res = NextResponse.next();
    if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }

  const role = await readRole(req);

  if (pathname === '/' || pathname === '/login') {
    if (role) return NextResponse.redirect(new URL(home(role), req.url));
    if (pathname === '/') return NextResponse.redirect(new URL('/login', req.url));
    return NextResponse.next();
  }

  const isConsole = matches(pathname, CONSOLE_PREFIXES);
  const isField = matches(pathname, [FIELD_PREFIX]);
  if (!isConsole && !isField) return NextResponse.next();

  if (!role) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (isConsole && role === 'SALESPERSON') return NextResponse.redirect(new URL('/field', req.url));
  if (isConsole && role === 'MANAGER' && matches(pathname, ADMIN_ONLY_PREFIXES)) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  if (isField && role !== 'SALESPERSON') return NextResponse.redirect(new URL('/dashboard', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)'],
};
