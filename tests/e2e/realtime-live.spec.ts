import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { login } from './helpers';

/** Real-time behaviour in the browser: live data, honest tracking states, recovery after a connection drop. */
async function apiAs(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined, identifier: string): Promise<APIRequestContext> {
  const ctx: APIRequestContext = await playwright.request.newContext({ baseURL });
  const r = await ctx.post('/api/auth/login', { data: { company: 'default', identifier, password: 'Password123!' } });
  expect(r.ok()).toBe(true);
  return ctx;
}

test.describe('live updates', () => {
  test('a product added by someone else appears without reloading — and is recovered after a connection drop', async ({ page, context, playwright, baseURL }) => {
    await login(page, 'admin@erp.com');
    await page.goto('/products');
    await expect(page.locator('tr', { hasText: 'SAM-CHG-01' })).toBeVisible();

    const mgr = await apiAs(playwright, baseURL, 'manager@erp.com');
    const cat = (await (await mgr.get('/api/products/meta/categories')).json()).data[0];
    const add = async (sku: string) =>
      expect((await mgr.post('/api/products', { data: { sku, name: `Live ${sku}`, categoryId: cat.id, brand: 'E2E', unit: 'PCS', sellingPrice: 10, mrp: 12, taxRate: 18, stock: 4 } })).status()).toBe(201);

    const live = `E2E-LIVE-${Date.now()}`;
    await add(live);
    await expect(page.locator('tr', { hasText: live })).toBeVisible({ timeout: 10_000 }); // pushed, no reload

    // The connection drops; a product is added meanwhile; when the connection returns the page catches up.
    const missed = `E2E-MISSED-${Date.now()}`;
    await context.setOffline(true);
    await add(missed);
    await page.waitForTimeout(800);
    await context.setOffline(false);
    await expect(page.locator('tr', { hasText: missed })).toBeVisible({ timeout: 30_000 });
    await mgr.dispose();
  });

  test('the live map tells the truth: no fix → live → permission denied → live again, all without reloading', async ({ page, playwright, baseURL }) => {
    await login(page, 'admin@erp.com');
    await page.goto('/salespersons/live');
    const card = page.locator('div', { has: page.getByRole('heading', { name: /Rahul Sharma/ }) }).filter({ has: page.locator('[data-live-state]') }).last();

    // Rahul is on duty (seeded) but no position has ever been reported: never "live", nothing guessed.
    // (Earlier tests may have signed him in on a browser without location permission, so his phone may
    // already have reported a refusal — that is shown too; either way it is not "live".)
    await expect(card.getByText('No GPS recorded')).toBeVisible();
    await expect(card.locator('[data-live-state]')).not.toHaveAttribute('data-live-state', 'live');

    const rahul = await apiAs(playwright, baseURL, 'rahul@erp.com');
    const fix = (n: number) => ({ clientPointId: `e2e-live-${Date.now()}-${n}`, latitude: 12.871 + n * 0.00003, longitude: 74.842, accuracy: 9, speed: 3, /* ~3 m apart: fixes seconds apart must be plausible */ timestamp: new Date().toISOString() });

    expect((await rahul.post('/api/location/batch', { data: { points: [fix(0)] } })).status()).toBe(200);
    await expect(card.locator('[data-live-state]')).toHaveAttribute('data-live-state', 'live', { timeout: 10_000 });
    await expect(card.getByText(/Live · /)).toBeVisible();
    await expect(card.getByText('±9 m')).toBeVisible();

    // The phone reports that location permission was refused: the console says so instead of "stale".
    expect((await rahul.post('/api/location/status', { data: { state: 'PERMISSION_DENIED', detail: 'Location permission refused on the phone' } })).status()).toBe(200);
    await expect(card.locator('[data-live-state]')).toHaveAttribute('data-live-state', 'permission_denied', { timeout: 10_000 });
    await expect(card.getByText('Location permission denied on the phone')).toBeVisible();

    // Permission restored and a new fix arrives: live again.
    expect((await rahul.post('/api/location/batch', { data: { points: [fix(1)] } })).status()).toBe(200);
    await expect(card.locator('[data-live-state]')).toHaveAttribute('data-live-state', 'live', { timeout: 10_000 });
    await rahul.dispose();
  });

  test('another company’s people never appear on this company’s live map', async ({ page }) => {
    await login(page, 'admin@erp.com');
    await page.goto('/salespersons/live');
    await expect(page.getByRole('heading', { name: /Rahul Sharma/ })).toBeVisible();
    await expect(page.getByText('Gita Rao')).toHaveCount(0);
    await expect(page.getByText('Hari Das')).toHaveCount(0);
  });

  test('route history shows the shift with an honest record label', async ({ page }) => {
    await login(page, 'admin@erp.com');
    await page.goto('/salespersons/route');
    await expect(page.getByRole('heading', { name: 'Tracked shifts' })).toBeVisible();
    await expect(page.getByText(/Tracked shifts/)).toBeVisible();
    await expect(page.getByText(/no distance is assumed across a gap/i)).toBeVisible();
  });
});
