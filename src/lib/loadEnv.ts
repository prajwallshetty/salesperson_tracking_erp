/**
 * Loads .env files with Next.js semantics before any other server module reads process.env.
 * Must be the first import of server.ts (ES imports evaluate in order).
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
