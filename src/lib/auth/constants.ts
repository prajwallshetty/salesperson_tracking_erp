/** Edge-safe auth constants (imported by middleware). */
export const SESSION_COOKIE = 'sg_session';
/** Legacy token lifetime: login always issued 7-day tokens. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** "Remember me" off: shorter token, and the cookie lasts only for the browser/app session. */
export const SHORT_SESSION_SECONDS = 12 * 60 * 60;
/** Tokens younger than this are not re-issued by /api/auth/refresh. */
export const REFRESH_MIN_AGE_SECONDS = 60 * 60;

/** Request header set by the middleware with the page path, for the session-ended return path. */
export const PATH_HEADER = 'x-salesgrid-path';
