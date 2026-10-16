import jwt from 'jsonwebtoken';
import { config } from '@/lib/config';
import type { Role } from '@/lib/permissions';
import { SESSION_MAX_AGE_SECONDS } from './constants';

export interface TokenPayload {
  userId: string;
  role: Role;
  iat?: number;
  exp?: number;
}

/** Same claims and lifetime as the legacy API, so previously issued tokens remain valid. */
export function signSessionToken(userId: string, role: Role): string {
  return jwt.sign({ userId, role }, config.jwtSecret, { expiresIn: SESSION_MAX_AGE_SECONDS });
}

export function verifySessionToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload & { id?: string };
    const userId = decoded.userId || decoded.id;
    if (!userId) return null;
    return { ...decoded, userId };
  } catch {
    return null;
  }
}
