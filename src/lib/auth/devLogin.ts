/**
 * Development quick login. Enabled only when DEV_QUICK_LOGIN=true AND NODE_ENV is not
 * "production" — a production build/server never honours it, whatever the environment says.
 * It signs in as an existing active user without a password, so it never ships credentials to
 * the browser; it must never be enabled on a server reachable by untrusted people.
 */
export function devQuickLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEV_QUICK_LOGIN === 'true' && env.NODE_ENV !== 'production';
}
