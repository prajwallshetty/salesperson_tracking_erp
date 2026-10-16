/** Edge-safe auth constants (imported by middleware). */
export const SESSION_COOKIE = 'sg_session';
/** Legacy token lifetime: login always issued 7-day tokens. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Tokens younger than this are not re-issued by /api/auth/refresh. */
export const REFRESH_MIN_AGE_SECONDS = 60 * 60;
