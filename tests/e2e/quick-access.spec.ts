import { test, expect } from '@playwright/test';

/** Quick access login on the production build (desktop project). */
async function signIn(page: import('@playwright/test').Page, identifier: string, remember: boolean) {
  await page.goto('/login');
  const company = page.getByLabel('Company code');
  await company.waitFor({ timeout: 8000 });
  if ((await company.inputValue()) === '') await company.fill('default');
  await page.getByLabel(/employee code/i).fill(identifier);
  await page.getByLabel('Password').fill('Password123!');
  const box = page.getByLabel('Remember me');
  if (remember) await box.check();
  else await box.uncheck();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

const sessionCookie = async (page: import('@playwright/test').Page) =>
  (await page.context().cookies()).find((c) => c.name === 'sg_session');

test.describe('quick access login', () => {
  test('without Remember me the session cookie ends with the browser session', async ({ page }) => {
    await signIn(page, 'manager@erp.com', false);
    await expect(page).toHaveURL(/\/dashboard$/);
    const c = await sessionCookie(page);
    expect(c?.httpOnly).toBe(true);
    expect(c?.expires).toBe(-1); // session cookie
  });

  test('with Remember me: 7-day cookie, dashboard opens directly, and the name is prefilled after sign-out', async ({ page }) => {
    await signIn(page, 'manager@erp.com', true);
    const c = await sessionCookie(page);
    const days = (c!.expires - Date.now() / 1000) / 86400;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    // A valid session opens the right interface automatically.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);

    // Sign out ends the session; only the (non-secret) sign-in name is remembered.
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await sessionCookie(page)).toBeUndefined();
    await expect(page.getByLabel(/employee code/i)).toHaveValue('manager@erp.com');
    await expect(page.getByLabel('Company code')).toHaveValue('default'); // remembered with the name (not secret)
    await expect(page.getByLabel('Password')).toHaveValue('');
    await expect(page.getByLabel('Remember me')).toBeChecked();
    const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(stored).not.toMatch(/Password123|sg_session|eyJ/);

    // "Not you?" forgets it.
    await page.getByRole('button', { name: 'Not you?' }).click();
    await expect(page.getByLabel(/employee code/i)).toHaveValue('');
    await expect(page.getByLabel('Company code')).toHaveValue('');
    await expect(page.getByLabel('Remember me')).not.toBeChecked();
  });

  test('a salesperson session opens the field app, not the console', async ({ page }) => {
    await signIn(page, 'rahul@erp.com', true);
    await expect(page).toHaveURL(/\/field$/);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/field$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/field$/);
  });

  test('development quick login is unavailable in production even with DEV_QUICK_LOGIN=true', async ({ page, request }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Development quick login')).toHaveCount(0);
    expect((await request.get('/api/auth/dev-login')).status()).toBe(404);
    const list = await request.post('/api/auth/dev-login', { data: { userId: '00000000-0000-0000-0000-000000000000' } });
    expect(list.status()).toBe(404);
  });
});
