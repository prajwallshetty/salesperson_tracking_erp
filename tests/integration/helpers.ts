export const BASE = () => process.env.TEST_BASE_URL || 'http://localhost:3100';

export interface Session {
  token: string;
  user: any;
  cookie: string;
}

export async function api(path: string, opts: { method?: string; token?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await fetch(`${BASE()}${path}`, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, headers: res.headers, text };
}

/** Signs in to a company (default: the original company, code `default`). */
export async function login(identifier: string, password = 'Password123!', company = 'default'): Promise<Session> {
  const r = await api('/api/auth/login', { body: { company, identifier, password } });
  if (r.status !== 200) throw new Error(`login ${identifier} failed: ${r.status} ${JSON.stringify(r.json)}`);
  const setCookie = r.headers.get('set-cookie') || '';
  return { token: r.json.token, user: r.json.user, cookie: setCookie.split(';')[0] };
}

export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
