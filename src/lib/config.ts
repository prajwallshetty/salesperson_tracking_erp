import path from 'path';

/**
 * Server-side configuration. Never import this from client components:
 * it reads secrets (JWT_SECRET, DATABASE_URL).
 */

const DEV_FALLBACK_SECRET = 'salesgrid-dev-only-secret-do-not-use-in-production';

const parseList = (raw?: string): string[] =>
  (raw || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  get isProduction() {
    return this.nodeEnv === 'production';
  },
  jwtSecret: process.env.JWT_SECRET || DEV_FALLBACK_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  /** Extra origins allowed to call the API cross-origin (e.g. a native client during transition). */
  corsOrigins: parseList(process.env.CORS_ORIGINS),
  /** Legacy `?token=` authentication (off unless ALLOW_QUERY_TOKEN=true). */
  allowQueryToken: process.env.ALLOW_QUERY_TOKEN === 'true',
  /** Optional shared state for running more than one instance (Socket.IO adapter, rate limits). */
  redisUrl: process.env.REDIS_URL || '',
  /** Secure cookies require HTTPS; disable only for plain-HTTP local/LAN testing. */
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
};

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/** Same rules as the legacy API's validateConfig(). Throws in production. */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
  const errors: string[] = [];
  const nodeEnv = env.NODE_ENV || 'development';

  const dbUrl = env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim() === '') {
    errors.push('DATABASE_URL is missing. Please configure a valid PostgreSQL connection string.');
  } else if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL is invalid: must start with postgresql:// or postgres://');
  }

  const redisUrl = env.REDIS_URL;
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    errors.push('REDIS_URL is invalid: must start with redis:// or rediss://');
  }

  if (nodeEnv === 'production') {
    const secret = env.JWT_SECRET;
    if (!secret || secret.trim() === '') {
      errors.push('JWT_SECRET is required in production environment.');
    } else if (
      secret === DEV_FALLBACK_SECRET ||
      secret === 'super-secret-salesperson-erp-key-2026-production-ready' ||
      secret.toLowerCase().includes('change-in-production') ||
      secret.toLowerCase().includes('example') ||
      secret.length < 32
    ) {
      errors.push('JWT_SECRET is insecure for production. It must not use default/example placeholders and must be at least 32 characters long.');
    }
    for (const origin of parseList(env.CORS_ORIGINS)) {
      if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
        errors.push(`Invalid origin in CORS_ORIGINS: "${origin}". Origins must include protocol (e.g. https://app.example.com).`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
