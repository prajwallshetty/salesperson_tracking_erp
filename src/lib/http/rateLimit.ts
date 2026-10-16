/**
 * Fixed-window in-memory rate limiter (replaces express-rate-limit).
 * State is per process: correct for the single-instance custom server. If you scale to
 * multiple instances, put a shared store (e.g. Redis) behind `hit()`.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const store: Map<string, Bucket> =
  ((globalThis as any).__salesgridRateLimit ??= new Map<string, Bucket>());

export interface RateLimitRule {
  name: string;
  windowMs: number;
  max: number;
  message: string;
}

export const AUTH_LIMIT: RateLimitRule = {
  name: 'auth',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
  message: 'Too many authentication attempts, please try again in 15 minutes',
};

export const API_LIMIT: RateLimitRule = {
  name: 'api',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 1000),
  message: 'API rate limit exceeded. Please slow down.',
};

export function hit(rule: RateLimitRule, key: string, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
  const id = `${rule.name}:${key}`;
  let bucket = store.get(id);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    store.set(id, bucket);
  }
  bucket.count += 1;
  if (store.size > 50_000) {
    for (const [k, b] of store) if (now >= b.resetAt) store.delete(k);
  }
  return { allowed: bucket.count <= rule.max, remaining: Math.max(0, rule.max - bucket.count), resetAt: bucket.resetAt };
}
