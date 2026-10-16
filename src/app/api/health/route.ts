import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getIO } from '@/lib/realtime/emitter';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export async function GET() {
  let database: 'up' | 'down' = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  return NextResponse.json(
    {
      status: database === 'up' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      version: '2.0.0',
      database,
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
