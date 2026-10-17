import { test, expect, type BrowserContext } from '@playwright/test';
import { login, watchErrors } from './helpers';

/**
 * Salesperson day on a phone (Pixel 7 profile) with browser geolocation granted and positioned
 * at the client's registered location (Ocean Telecom Udupi, assigned to Vishal).
 */
const OCEAN = { latitude: 13.3409, longitude: 74.7421, accuracy: 12 };

test.describe.serial('salesperson field day', () => {
  let ctx: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({
      ...test.info().project.use,
      geolocation: OCEAN,
      permissions: ['geolocation'],
    });
  });
  test.afterAll(async () => ctx.close());

  test('login lands on the field home with mobile navigation', async () => {
    const page = await ctx.newPage();
    const watch = watchErrors(page);
    await login(page, 'vishal@erp.com');
    await expect(page).toHaveURL(/\/field$/);
    await expect(page.getByRole('heading', { name: /Vishal/ })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Field navigation' });
    for (const tab of ['Home', 'Clients', 'Orders', 'Expenses', 'More']) await expect(nav.getByRole('link', { name: tab })).toBeVisible();
    await expect(page.getByText('Off duty', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    watch.assertClean();
    await page.close();
  });

  test('start day enables tracking with a real GPS fix', async () => {
    const page = await ctx.newPage();
    await page.goto('/field');
    await page.getByRole('button', { name: /Start day/ }).click();
    await expect(page.getByText(/You are on duty/)).toBeVisible();
    await expect(page.getByText('ON DUTY').first()).toBeVisible();
    await expect(page.getByText(/GPS live · last fix/)).toBeVisible();
    await page.close();
  });

  test('visit a client: distance verified, outcome recorded', async () => {
    const page = await ctx.newPage();
    await page.goto('/field/clients');
    const card = page.locator('li', { hasText: 'Ocean Telecom Udupi' });
    await card.getByRole('button', { name: 'Visit' }).click();
    const dialog = page.getByRole('dialog', { name: /Start visit/ });
    await expect(dialog.getByText(/Within the 100 m client radius/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Begin visit' }).click();
    await expect(page.getByText('Visit in progress')).toBeVisible();
    await page.getByRole('button', { name: 'Complete' }).click();
    const done = page.getByRole('dialog', { name: /Complete visit/ });
    await done.getByRole('button', { name: 'Order taken' }).click();
    await done.getByLabel('Notes & follow-up').fill('Reviewed festival stock');
    await done.getByRole('button', { name: 'Record visit' }).click();
    await expect(page.getByText(/Visit to Ocean Telecom Udupi recorded/)).toBeVisible();
    await page.close();
  });

  test('book an order with live GST totals', async () => {
    const page = await ctx.newPage();
    await page.goto('/field/orders?new=1');
    const sheet = page.getByRole('dialog', { name: 'New sales order' });
    await sheet.getByLabel('Client').selectOption({ label: 'Ocean Telecom Udupi — Udupi' });
    await sheet.getByLabel('Quantity of Samsung 25W Fast Charger').fill('10');
    await sheet.getByLabel('Quantity of Samsung Type-C to Type-C Cable').fill('5');
    await sheet.getByLabel('Quantity of Samsung Multiport Travel Adapter').fill('2');
    await sheet.getByLabel('Order discount (₹)').fill('450');
    await expect(sheet.getByRole('button', { name: /Submit order · ₹7,788/ })).toBeVisible();
    await sheet.getByRole('button', { name: /Submit order/ }).click();
    await expect(page.getByText(/Order ORD-\d{4}-\d{6} booked/)).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Ocean Telecom Udupi').first()).toBeVisible();
    await page.close();
  });

  test('collect a payment and get a receipt', async () => {
    const page = await ctx.newPage();
    await page.goto('/field/collect');
    await page.getByRole('button', { name: '+ Collect payment' }).click();
    const sheet = page.getByRole('dialog', { name: 'Collect payment' });
    await sheet.getByLabel('Client').selectOption({ index: 1 });
    await sheet.getByLabel('Amount collected (₹)').fill('2500');
    await sheet.getByLabel(/Transaction reference/).fill('UPI-E2E-1');
    await sheet.getByRole('button', { name: 'Record collection' }).click();
    const receipt = page.getByRole('dialog', { name: 'Payment received' });
    await expect(receipt.getByText(/PAY-\d{4}-\d{5}/)).toBeVisible();
    await expect(receipt.getByText('PENDING')).toBeVisible();
    await receipt.getByRole('button', { name: 'Done' }).click();
    await page.close();
  });

  test('submit an expense claim', async () => {
    const page = await ctx.newPage();
    await page.goto('/field/expenses');
    await page.getByRole('button', { name: '+ New claim' }).click();
    const sheet = page.getByRole('dialog', { name: 'New expense claim' });
    await sheet.getByRole('button', { name: 'Fuel' }).click();
    await sheet.getByLabel('Amount (₹)').fill('320');
    await sheet.getByLabel('Description').fill('Fuel for Udupi route');
    await sheet.getByRole('button', { name: 'Submit claim' }).click();
    await expect(page.getByText('Claim submitted for approval.')).toBeVisible();
    await expect(page.getByText('Fuel for Udupi route')).toBeVisible();
    await page.close();
  });

  test('offline order is queued, clearly labelled, and synced on reconnect', async () => {
    const page = await ctx.newPage();
    await page.goto('/field/orders');
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await page.getByRole('button', { name: '+ New order' }).click();
    const sheet = page.getByRole('dialog', { name: 'New sales order' });
    await sheet.getByLabel('Client').selectOption({ label: 'Ocean Telecom Udupi — Udupi' });
    await sheet.getByLabel('Quantity of Anker PowerCore 10,000mAh').fill('1');
    await ctx.setOffline(true);
    await sheet.getByRole('button', { name: /Submit order/ }).click();
    await expect(page.getByText(/No connection. The order is saved on this device/)).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(/1 to sync/)).toBeVisible();
    await ctx.setOffline(false);
    // The `online` event triggers sync automatically.
    await expect(page.getByText(/1 to sync/)).toHaveCount(0, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByText(/Anker|Ocean Telecom Udupi/).first()).toBeVisible();
    await page.close();
  });

  test("today's route shows the recorded path and visits", async () => {
    const page = await ctx.newPage();
    await page.goto('/field/more/route');
    await expect(page.getByText(/GPS points/)).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: /^1$/ }).first()).toBeVisible(); // 1 visit
    await page.close();
  });

  test('end day shows the daily summary', async () => {
    const page = await ctx.newPage();
    await page.goto('/field');
    await page.getByRole('button', { name: /End day/ }).click();
    await page.getByRole('dialog', { name: 'End your day?' }).getByRole('button', { name: 'End day' }).click();
    const summary = page.getByRole('dialog', { name: "Today's summary" });
    await expect(summary.getByText('Orders booked')).toBeVisible();
    await expect(summary.getByText('₹2,500')).toBeVisible(); // pending collection
    await summary.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Off duty', { exact: true })).toBeVisible();
    await page.close();
  });

  test('attendance history shows the completed shift', async () => {
    const page = await ctx.newPage();
    await page.goto('/field/more/attendance');
    await expect(page.getByText('COMPLETED').first()).toBeVisible();
    await page.close();
  });
});

test('denied location permission is explained, the day can still start without GPS, and the console is told', async ({ browser, playwright, baseURL }) => {
  const ctx = await browser.newContext({ ...test.info().project.use, permissions: [] });
  const page = await ctx.newPage();
  // Simulate the browser refusing geolocation.
  await page.addInitScript(() => {
    const deny = (_s: unknown, err?: (e: { code: number; message: string }) => void) => err?.({ code: 1, message: 'User denied Geolocation' });
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: deny, watchPosition: (s: unknown, e: any) => (deny(s, e), 1), clearWatch: () => undefined } });
  });
  await login(page, 'ahmed@erp.com');
  await expect(page).toHaveURL(/\/field$/);
  // Seed leaves Ahmed ON_DUTY without an open shift; end it via the UI if needed.
  if (await page.getByRole('button', { name: /End day/ }).isVisible()) {
    await page.getByRole('button', { name: /End day/ }).click();
    await page.getByRole('dialog', { name: 'End your day?' }).getByRole('button', { name: 'End day' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click().catch(() => undefined);
  }
  await page.getByRole('button', { name: /Start day/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Location unavailable' });
  await expect(dialog.getByText(/Location permission is blocked/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Start without GPS' }).click();
  await expect(page.getByText(/Day started without a location fix/)).toBeVisible();
  await expect(page.getByText(/Location permission is blocked/)).toBeVisible();

  // The phone reported its own state to the server, so managers see "permission denied", not just silence.
  const admin = await playwright.request.newContext({ baseURL });
  await admin.post('/api/auth/login', { data: { company: 'default', identifier: 'admin@erp.com', password: 'Password123!' } });
  await expect
    .poll(async () => {
      const rows = (await (await admin.get('/api/salespersons/live-status')).json()).data as any[];
      return rows.find((r) => r.employeeCode === 'EMP-002')?.liveState;
    }, { timeout: 20_000 })
    .toBe('permission_denied');
  await admin.dispose();
  await ctx.close();
});

test('signing out with "every other device" also ends the session on a second phone', async ({ browser }) => {
  const use = test.info().project.use;
  const [ctxA, ctxB] = await Promise.all([browser.newContext({ ...use }), browser.newContext({ ...use })]);
  const [a, b] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  await login(b, 'ahmed@erp.com');
  await login(a, 'ahmed@erp.com');

  await a.goto('/field/more/profile');
  await a.getByRole('button', { name: 'Sign out' }).click();
  const sheet = a.getByRole('dialog', { name: 'Sign out?' });
  await sheet.getByLabel(/Also sign out on every other device/).check();
  await sheet.getByRole('button', { name: 'Sign out' }).click();
  await expect(a).toHaveURL(/\/login/);

  await b.reload();
  await expect(b).toHaveURL(/\/login\?expired=1/);
  await Promise.all([ctxA.close(), ctxB.close()]);
});
