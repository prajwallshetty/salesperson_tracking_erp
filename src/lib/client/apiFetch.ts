'use client';

/**
 * Browser fetch wrapper for same-origin API calls. Authentication rides on the httpOnly
 * session cookie (never readable by JS). On 401 the session has expired or been revoked:
 * redirect to login, preserving the current page.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { field: string; message: string }[]) {
    super(message);
  }
}

/** True when the request never reached the server (offline, DNS, connection reset). */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === 'AbortError');
}

let redirecting = false;
function handleUnauthorized() {
  if (typeof window === 'undefined' || redirecting) return;
  if (window.location.pathname === '/login') return;
  redirecting = true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}&expired=1`);
}

/** Drop-in replacement for `fetch` (returns the Response) with session-expiry handling. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, { credentials: 'same-origin', ...init });
  if (res.status === 401 && !input.startsWith('/api/auth/')) handleUnauthorized();
  return res;
}

/** JSON helper: parses the body and throws ApiError with the server's message on failure. */
export async function apiJson<T = any>(input: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await apiFetch(input, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!res.ok) throw new ApiError(res.status, body.error || `Request failed (HTTP ${res.status})`, body.details);
  return body as T;
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError) {
    if (err.details?.length) return `${err.message}: ${err.details.map((d) => `${d.field || 'input'} — ${d.message}`).join('; ')}`;
    return err.message;
  }
  if (isNetworkError(err)) return 'Cannot reach the server. Check your connection and try again.';
  return (err as Error)?.message || fallback;
}
