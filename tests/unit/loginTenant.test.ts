import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { identityThrottled, IDENTITY_LIMIT } from '@/lib/auth/loginTenant';
import { isTenantUsable } from '@/lib/auth/session';

describe('per-account sign-in throttle', () => {
  const saved = process.env.DISABLE_RATE_LIMIT;
  beforeEach(() => delete process.env.DISABLE_RATE_LIMIT);
  afterEach(() => {
    if (saved === undefined) delete process.env.DISABLE_RATE_LIMIT;
    else process.env.DISABLE_RATE_LIMIT = saved;
  });

  it('allows normal use and answers 429 with Retry-After beyond the limit, per company and account', async () => {
    const t = `tenant-${Math.random()}`;
    for (let i = 0; i < IDENTITY_LIMIT.max; i++) expect(await identityThrottled(t, 'EMP-1')).toBeNull();
    const blocked = await identityThrottled(t, 'emp-1 '); // case/whitespace-insensitive
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another account, or the same identifier in another company, has its own budget.
    expect(await identityThrottled(t, 'EMP-2')).toBeNull();
    expect(await identityThrottled(`other-${t}`, 'EMP-1')).toBeNull();
  });
});

describe('subscription rule', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('is usable only while ACTIVE and before activeUntil', () => {
    expect(isTenantUsable({ status: 'ACTIVE', activeUntil: null }, now)).toBe(true);
    expect(isTenantUsable({ status: 'ACTIVE', activeUntil: new Date('2026-06-02T00:00:00Z') }, now)).toBe(true);
    expect(isTenantUsable({ status: 'ACTIVE', activeUntil: new Date('2026-05-31T23:59:59Z') }, now)).toBe(false);
    expect(isTenantUsable({ status: 'ACTIVE', activeUntil: now }, now)).toBe(false);
    expect(isTenantUsable({ status: 'SUSPENDED', activeUntil: null }, now)).toBe(false);
  });
});
