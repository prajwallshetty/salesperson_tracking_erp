import dotenv from 'dotenv';
import path from 'path';

// Load isolated api/.env directly from api folder, avoiding parent/monorepo bleed
const apiEnvPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: apiEnvPath });

const parseOrigins = (raw?: string): string[] => {
  if (!raw) return ['http://localhost:3000', 'http://localhost:8081', 'http://localhost:19006'];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
};

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: process.env.JWT_SECRET || 'super-secret-salesperson-erp-key-2026-production-ready',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  nodeEnv: process.env.NODE_ENV || 'development',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads')),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
};

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateConfig(cfg = config): ConfigValidationResult {
  const errors: string[] = [];

  // Database URL validation
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim() === '') {
    errors.push('DATABASE_URL is missing. Please configure a valid PostgreSQL connection string.');
  } else if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL is invalid: must start with postgresql:// or postgres://');
  }

  // JWT Secret validation
  const jwtSec = process.env.JWT_SECRET;
  if (cfg.nodeEnv === 'production') {
    if (!jwtSec || jwtSec.trim() === '') {
      errors.push('JWT_SECRET is required in production environment.');
    } else if (
      jwtSec === 'super-secret-salesperson-erp-key-2026-production-ready' ||
      jwtSec.toLowerCase().includes('change-in-production') ||
      jwtSec.toLowerCase().includes('example') ||
      jwtSec.length < 32
    ) {
      errors.push(
        'JWT_SECRET is insecure for production. It must not use default/example placeholders and must be at least 32 characters long.'
      );
    }
  }

  // CORS validation in production
  if (cfg.nodeEnv === 'production') {
    if (!process.env.CORS_ORIGINS || cfg.corsOrigins.length === 0) {
      errors.push(
        'CORS_ORIGINS is required in production. Specify comma-separated allowed frontend domains (e.g. https://example.com,https://admin.example.com).'
      );
    } else {
      for (const origin of cfg.corsOrigins) {
        if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
          errors.push(
            `Invalid origin in CORS_ORIGINS: "${origin}". Origins must include protocol (e.g. https://admin.example.com).`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    const errorMsg = [
      '=================================================================',
      '  API CONFIGURATION VALIDATION FAILED',
      '=================================================================',
      ...errors.map((e) => `  * ${e}`),
      '=================================================================',
    ].join('\n');

    if (cfg.nodeEnv === 'production') {
      throw new Error(errorMsg);
    } else {
      console.warn(errorMsg);
    }

    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

