import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getIO } from '@/lib/realtime/emitter';
import { getRedis, redisEnabled } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export async function GET() {
  let database: 'up' | 'down' = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  // Redis is optional; when configured and down, rate limits fall back to per-instance counters
  // and realtime events may not cross instances, so report it without failing the health check.
  let redis: 'up' | 'down' | 'disabled' = 'disabled';
  if (redisEnabled()) {
    try {
      const client = await getRedis();
      redis = client && (await client.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      redis = 'down';
    }
  }
  return NextResponse.json(
    {
      status: database === 'up' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      version: '2.0.0',
      database,
      redis,
      features: {
        socketIO: Boolean(getIO()),
        accessCodeAuth: true,
        expensesManagement: true,
        routeTracking: true,
      },
    },
    { status: database === 'up' ? 200 : 503 }
  );
}
