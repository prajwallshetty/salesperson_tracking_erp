import type { NextRequest } from 'next/server';
import { badRequest } from './errors';

export function clientIp(req: NextRequest | Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

export function userAgent(req: NextRequest | Request): string {
  return req.headers.get('user-agent') || req.headers.get('x-device-id') || 'Unknown Device';
}

/** Parses a JSON body; an empty body yields `{}` (Express `express.json()` behaviour). */
export async function readJson<T = any>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest('Malformed JSON request body');
  }
}

export function searchParams(req: NextRequest | Request) {
  return new URL(req.url).searchParams;
}

/** Bounded pagination (legacy: limit/offset with defaults; now capped to protect the DB). */
export function pagination(params: URLSearchParams, defaults: { limit: number; max?: number } = { limit: 50 }) {
  const max = defaults.max ?? 500;
  const rawLimit = parseInt(params.get('limit') || '', 10);
  const rawOffset = parseInt(params.get('offset') || '', 10);
  const limit = Math.min(max, Math.max(1, isNaN(rawLimit) ? defaults.limit : rawLimit));
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);
  return { limit, offset };
}
