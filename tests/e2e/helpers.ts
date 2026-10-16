import { expect, type Page, type ConsoleMessage } from '@playwright/test';

export async function login(page: Page, identifier: string, secret = 'Password123!', mode: 'password' | 'code' = 'password', expectSuccess = true) {
  await page.goto('/login');
  if (mode === 'code') await page.getByRole('tab', { name: 'Access code' }).click();
  await page.getByLabel(/employee code/i).fill(identifier);
  await page.getByLabel(mode === 'code' ? 'Personal access code' : 'Password').fill(secret);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Login navigates with a full page load; wait for it so later goto() calls don't abort it.
  if (expectSuccess) {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.waitForLoadState('networkidle');
  }
}

/** Collects console errors and failed same-origin requests for a page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Map tiles are third-party and may be blocked in CI sandboxes.
    if (/tile\.openstreetmap|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|Failed to load resource: net::/i.test(text)) return;
    // Next.js logs this when a test navigates away mid-prefetch; it then falls back to a full load.
    if (/Failed to fetch RSC payload/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.host === new URL(page.url() || 'http://localhost').host && r.status() >= 500) errors.push(`HTTP ${r.status()} ${url.pathname}`);
  });
  return {
    errors,
    assertClean: () => expect(errors, errors.join('\n')).toEqual([]),
  };
}
