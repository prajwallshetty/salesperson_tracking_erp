import jwt from 'jsonwebtoken';
import { config } from '@/lib/config';
import type { Role } from '@/lib/permissions';
import { SESSION_MAX_AGE_SECONDS, SHORT_SESSION_SECONDS } from './constants';

export interface TokenPayload {
  userId: string;
  role: Role;
  /** Session version (users.tokenVersion at issue time). Absent on legacy tokens = 0. */
  tv: number;
  /** "Remember me". Absent on legacy tokens = true (they were always 7-day persistent sessions). */
  rm: boolean;
  iat?: number;
  exp?: number;
}

/**
 * Same claims and lifetime as the legacy API (`userId`, `role`, 7 days) plus `tv`, the user's
 * session version. Legacy tokens without `tv` stay valid until the user's sessions are revoked.
 */
export function signSessionToken(userId: string, role: Role, tokenVersion = 0, remember = true): string {
  return jwt.sign({ userId, role, tv: tokenVersion, rm: remember }, config.jwtSecret, {
    expiresIn: remember ? SESSION_MAX_AGE_SECONDS : SHORT_SESSION_SECONDS,
  });
}

export function verifySessionToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as Partial<TokenPayload> & { id?: string };
    const userId = decoded.userId || decoded.id;
    if (!userId) return null;
    const tv = Number.isInteger(decoded.tv) ? (decoded.tv as number) : 0;
    return { ...decoded, userId, role: decoded.role as Role, tv, rm: decoded.rm !== false };
  } catch {
    return null;
  }
}
