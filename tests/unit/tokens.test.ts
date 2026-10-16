import { describe, it, expect, vi, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstu';

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return {
    tokens: await import('@/lib/auth/tokens'),
    session: await import('@/lib/auth/session'),
  };
}

afterEach(() => {
  delete process.env.ALLOW_QUERY_TOKEN;
});

describe('session tokens', () => {
  it('carry the session version and treat legacy tokens (no tv) as version 0', async () => {
    const { tokens } = await load({ JWT_SECRET: SECRET });
    const t = tokens.signSessionToken('u1', 'SALESPERSON', 3);
    expect(tokens.verifySessionToken(t)).toMatchObject({ userId: 'u1', role: 'SALESPERSON', tv: 3 });
    const legacy = jwt.sign({ userId: 'u1', role: 'SALESPERSON' }, SECRET);
    expect(tokens.verifySessionToken(legacy)?.tv).toBe(0);
    const legacyId = jwt.sign({ id: 'u2', role: 'MANAGER' }, SECRET);
    expect(tokens.verifySessionToken(legacyId)?.userId).toBe('u2');
    expect(tokens.verifySessionToken(jwt.sign({ userId: 'u1' }, 'other-secret'))).toBeNull();
  });
});

describe('token extraction', () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it('prefers Bearer, then the session cookie', async () => {
    const { session } = await load({ JWT_SECRET: SECRET });
    expect(session.extractToken(req('http://x/api', { authorization: 'Bearer abc', cookie: 'sg_session=def' }))).toBe('abc');
    expect(session.extractToken(req('http://x/api', { authorization: 'Bearer null', cookie: 'a=1; sg_session=def' }))).toBe('def');
  });

  it('ignores ?token= unless ALLOW_QUERY_TOKEN=true', async () => {
    const off = await load({ JWT_SECRET: SECRET, ALLOW_QUERY_TOKEN: undefined });
    expect(off.session.extractToken(req('http://x/api?token=q'))).toBeNull();
    const on = await load({ JWT_SECRET: SECRET, ALLOW_QUERY_TOKEN: 'true' });
    expect(on.session.extractToken(req('http://x/api?token=q'))).toBe('q');
  });
});
