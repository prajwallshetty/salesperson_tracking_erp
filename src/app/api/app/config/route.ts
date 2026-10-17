import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const int = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

/**
 * Public, non-sensitive settings for the Android shell. Web changes ship by deploying the server;
 * these let an old native build be told it must update (only native changes need a new APK).
 */
export function GET() {
  return NextResponse.json(
    {
      android: {
        minBuild: int(process.env.ANDROID_MIN_BUILD),
        latestBuild: int(process.env.ANDROID_LATEST_BUILD),
        updateUrl: process.env.ANDROID_UPDATE_URL || null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
