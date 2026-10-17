import { createClient } from 'redis';
import { config } from '@/lib/config';

/**
 * Optional Redis connection for running several SalesGrid instances behind a load balancer.
 * Unset REDIS_URL = single-instance mode (in-process state), exactly as before.
 * One client per process, shared by the Socket.IO adapter and the rate limiter.
 */
export type RedisClient = ReturnType<typeof createClient>;

const g = globalThis as unknown as { __salesgridRedis?: Promise<RedisClient | null> };

export function redisEnabled(): boolean {
  return Boolean(config.redisUrl);
}

export function newRedisClient(): RedisClient {
  const client = createClient({
    url: config.redisUrl,
    // Fail fast while disconnected (callers fall back) instead of queueing and hanging requests.
    disableOfflineQueue: true,
    socket: { connectTimeout: 5000, reconnectStrategy: (n) => Math.min(n * 200, 5000) },
  });
  client.on('error', (err) => console.error('[redis]', err.message));
  return client;
}

export function getRedis(): Promise<RedisClient | null> {
  if (!redisEnabled()) return Promise.resolve(null);
  g.__salesgridRedis ??= (async () => {
    const client = newRedisClient();
    await client.connect();
    return client;
  })().catch((err) => {
    console.error('[redis] connection failed:', err.message);
    g.__salesgridRedis = undefined; // retry on the next call
    return null;
  });
  return g.__salesgridRedis;
}
