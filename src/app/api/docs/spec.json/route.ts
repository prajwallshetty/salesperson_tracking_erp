import { NextResponse } from 'next/server';
import { openApiSpec } from '@/features/docs/openapi';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(openApiSpec);
}
