import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { authenticateRequest } from '@/lib/auth/session';
import { hasPermission, type AuthenticatedUser, type ManagerPermissionKey, type Role } from '@/lib/permissions';
import { HttpError } from './errors';
import { API_LIMIT, hitShared, type RateLimitRule } from './rateLimit';
import { clientIp, userAgent } from './request';

export interface RequestContext<P = Record<string, string>> {
  req: NextRequest;
  params: P;
  ip: string;
  userAgent: string;
  tokenIat?: number;
  /** The session's "Remember me" choice (see signSessionToken). */
  tokenRemember?: boolean;
}

export interface AuthedContext<P = Record<string, string>> extends RequestContext<P> {
  user: AuthenticatedUser;
}

interface RouteOptions {
  /** Restrict to these roles (SUPER_ADMIN always passes — legacy `requireRole`). */
  roles?: Role[];
  /** Manager-only permission flag. Admins pass; salespersons are unaffected unless `roles` excludes them. */
  managerPermission?: ManagerPermissionKey;
  rateLimit?: RateLimitRule;
}

export function errorResponse(err: unknown, req?: NextRequest): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, ...(err.extra || {}) }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      },
      { status: 400 }
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'A record with this identifier already exists', meta: err.meta }, { status: 409 });
    }
    if (err.code === 'P2025') return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    if (err.code === 'P2003') return NextResponse.json({ error: 'Referenced record does not exist' }, { status: 400 });
  }
  console.error(`[API Error] ${req?.method ?? ''} ${req?.nextUrl?.pathname ?? ''}:`, err);
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal Server Error' : (err as Error)?.message || 'Internal Server Error';
  return NextResponse.json({ error: message }, { status: 500 });
}

type RouteArgs = { params?: Record<string, string | string[]> };

function baseContext<P>(req: NextRequest, args: RouteArgs | undefined): RequestContext<P> {
  return {
    req,
    params: (args?.params || {}) as P,
    ip: clientIp(req),
    userAgent: userAgent(req),
  };
}

async function applyRateLimit(rule: RateLimitRule, ip: string): Promise<Response | null> {
  if (process.env.DISABLE_RATE_LIMIT === 'true') return null;
  const r = await hitShared(rule, ip);
  if (!r.allowed) {
    return NextResponse.json(
      { error: rule.message },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((r.resetAt - Date.now()) / 1000)) } }
    );
  }
  return null;
}

/** Route handler that does not require authentication. */
export function publicRoute<P = Record<string, string>>(
  handler: (ctx: RequestContext<P>) => Promise<Response> | Response,
  opts: { rateLimit?: RateLimitRule } = {}
) {
  return async (req: NextRequest, args?: RouteArgs): Promise<Response> => {
    const ctx = baseContext<P>(req, args);
    const limited = await applyRateLimit(opts.rateLimit ?? API_LIMIT, ctx.ip);
    if (limited) return limited;
    try {
      return await handler(ctx);
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}

/** Authenticated route handler. Authorization is always evaluated server-side, per request. */
export function authedRoute<P = Record<string, string>>(
  opts: RouteOptions,
  handler: (ctx: AuthedContext<P>) => Promise<Response> | Response
) {
  return async (req: NextRequest, args?: RouteArgs): Promise<Response> => {
    const base = baseContext<P>(req, args);
    const limited = await applyRateLimit(opts.rateLimit ?? API_LIMIT, base.ip);
    if (limited) return limited;
    try {
      const { user, tokenIat, tokenRemember } = await authenticateRequest(req);
      if (!user) {
        return NextResponse.json({ error: 'Invalid or expired authentication token' }, { status: 401 });
      }
      if (opts.roles && user.role !== 'SUPER_ADMIN' && !opts.roles.includes(user.role)) {
        return NextResponse.json({ error: 'Forbidden: Insufficient privileges for this role' }, { status: 403 });
      }
      if (opts.managerPermission && user.role === 'MANAGER' && !hasPermission(user, opts.managerPermission)) {
        return NextResponse.json(
          { error: `Forbidden: Missing required permission [${opts.managerPermission}]` },
          { status: 403 }
        );
      }
      return await handler({ ...base, user, tokenIat, tokenRemember });
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
