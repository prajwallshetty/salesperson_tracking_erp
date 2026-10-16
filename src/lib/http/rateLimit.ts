import { getRedis, redisEnabled } from '@/lib/redis';

/**
 * Fixed-window rate limiter (replaces express-rate-limit).
 * Without REDIS_URL, counters are per process (single instance). With REDIS_URL, counters are
 * shared by every instance; if Redis is unreachable the per-process counters are used instead
 * (requests are never rejected because Redis is down).
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

// INCR + set the window expiry on first hit, atomically; returns [count, ms until reset].
const WINDOW_SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

export async function hitShared(rule: RateLimitRule, key: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (redisEnabled()) {
    try {
      const redis = await getRedis();
      if (redis) {
        const [count, ttl] = (await redis.eval(WINDOW_SCRIPT, {
          keys: [`salesgrid:rl:${rule.name}:${key}`],
          arguments: [String(rule.windowMs)],
        })) as [number, number];
        const now = Date.now();
        return { allowed: count <= rule.max, remaining: Math.max(0, rule.max - count), resetAt: now + Math.max(ttl, 0) };
      }
    } catch (err) {
      console.error('[rate-limit] Redis unavailable, using per-process counters:', (err as Error).message);
    }
  }
  return hit(rule, key);
}
