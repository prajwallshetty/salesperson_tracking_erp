import { test, expect } from '@playwright/test';
import { login, watchErrors } from './helpers';

const PAGES: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/salespersons/live', 'Live Field Tracking'],
  ['/salespersons', 'Sales Force Management'],
  ['/salespersons/access-codes', 'Salesperson Access Codes'],
  ['/salespersons/attendance', 'Attendance & Shift Logs'],
  ['/salespersons/performance', 'Salesperson Performance'],
  ['/salespersons/route', 'Daily Route History'],
  ['/clients', 'Client Relationship Management'],
  ['/clients/assignments', 'Territory & Client Assignments'],
  ['/clients/visits', 'Client Field Visits'],
  ['/products', 'Product Catalog & Inventory'],
  ['/orders', 'Sales Orders'],
  ['/payments', 'Collections & Receipts'],
  ['/expenses', 'Staff Expense Management'],
  ['/reports', 'Business Intelligence Reports'],
  ['/settings', 'System Configuration'],
  ['/audit-logs', 'Security Audit Trail'],
];

test.describe('admin console', () => {
  test('admin signs in and every console page renders without errors', async ({ page }) => {
    const watch = watchErrors(page);
    await login(page, 'admin@erp.com');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    for (const [path, title] of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title }), path).toBeVisible();
      await page.waitForLoadState('networkidle');
    }
    watch.assertClean();
  });

  test('sidebar navigation works and shows real pending counts', async ({ page }) => {
    await login(page, 'admin@erp.com');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('button', { name: /Expenses/ }).click();
    await nav.getByRole('link', { name: /Pending Approval/ }).last().click();
    await expect(page).toHaveURL(/\/expenses\?status=SUBMITTED/);
    // Seed has exactly one SUBMITTED expense; badge reflects the database, not a constant.
    await expect(nav.getByRole('link', { name: /Pending Approval\s*1/ }).last()).toBeVisible();
  });

  test('admin approves an expense claim end to end', async ({ page }) => {
    await login(page, 'admin@erp.com');
    await page.goto('/expenses?status=SUBMITTED');
    const row = page.locator('tr', { hasText: 'EXP-2026-001' });
    await expect(row.getByText('Rahul Sharma')).toBeVisible(); // legacy showed "Staff Member"
    await row.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('button', { name: 'Confirm Approval' }).click();
    await expect(page.locator('tr', { hasText: 'EXP-2026-001' })).toHaveCount(0); // left the SUBMITTED filter
    await page.goto('/expenses?status=APPROVED');
    await expect(page.locator('tr', { hasText: 'EXP-2026-001' }).getByText('Approved')).toBeVisible();
  });

  test('console pages show real data (regressions of legacy field mismatches)', async ({ page }) => {
    await login(page, 'admin@erp.com');

    await page.goto('/salespersons');
    const rahul = page.locator('tr', { hasText: 'EMP-001' });
    await expect(rahul.getByText('Rahul Sharma')).toBeVisible();
    await expect(rahul.getByText('3 Accounts')).toBeVisible();
    await expect(rahul.getByText('9876543212')).toBeVisible();

    await page.goto('/salespersons/access-codes');
    const code = page.locator('tr', { hasText: 'Rahul Sharma' });
    await expect(code.getByText('EMP-001')).toBeVisible();

    await page.goto('/products');
    await expect(page.locator('tr', { hasText: 'SAM-CHG-01' }).getByText('Mobile Accessories')).toBeVisible();

    await page.goto('/clients/assignments');
    await expect(page.getByText('Default Seed')).toHaveCount(0);

    const pending = (await (await page.request.get('/api/expenses?status=SUBMITTED&limit=1')).json()).meta.total;
    await page.goto('/expenses');
    await expect(page.getByText(`${pending} claims awaiting approval`)).toBeVisible();
    await expect(page.getByText('Staff Member')).toHaveCount(0);

    await page.goto('/salespersons/performance');
    await page.getByRole('combobox').first().selectOption({ label: 'Rahul Sharma (EMP-001)' });
    await page.getByRole('button', { name: 'All Time' }).click();
    await expect(page.getByText(/^[1-9]\d* purchase orders$/)).toBeVisible();
  });

  test('admin verifies a pending collection from the console', async ({ page, playwright, baseURL }) => {
    // Salesperson records a collection through the API in a separate session.
    const rep = await playwright.request.newContext({ baseURL });
    await rep.post('/api/auth/login', { data: { identifier: 'rahul@erp.com', password: 'Password123!' } });
    const client = (await (await rep.get('/api/clients')).json()).data[0];
    const created = await rep.post('/api/payments', { data: { clientId: client.id, amount: 1234, paymentMethod: 'UPI', transactionReference: 'UTR-E2E-VERIFY' } });
    const receipt = (await created.json()).data.receiptNumber;
    await rep.dispose();

    await login(page, 'admin@erp.com');
    await page.goto('/payments?status=PENDING');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: `Verify ${receipt}` }).click();
    await expect(page.locator('tr', { hasText: receipt })).toHaveCount(0);
    await page.goto('/payments');
    await expect(page.locator('tr', { hasText: receipt }).getByText('VERIFIED')).toBeVisible();
  });

  test('admin issues an access code that works for field login', async ({ page, browser }) => {
    await login(page, 'admin@erp.com');
    await page.goto('/salespersons/access-codes');
    await expect(page.getByRole('heading', { level: 1, name: 'Salesperson Access Codes' })).toBeVisible();
    // The page lists Rahul's seeded code.
    await expect(page.getByText(/Rahul Sharma/).first()).toBeVisible();
    const ctx = await browser.newContext();
    const field = await ctx.newPage();
    await login(field, 'EMP-001', 'RAHUL12345', 'code');
    await expect(field).toHaveURL(/\/field$/);
    await ctx.close();
  });

  test('logout ends the session and protects pages', async ({ page }) => {
    await login(page, 'admin@erp.com');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login\?next=%2Forders/);
  });

  test('"sign out of all devices" ends the admin session in other browsers too', async ({ page, browser }) => {
    const otherCtx = await browser.newContext();
    const other = await otherCtx.newPage();
    await login(other, 'admin@erp.com');
    await login(page, 'admin@erp.com');

    await page.getByRole('button', { name: 'Sign out of all devices' }).click();
    await page.getByRole('dialog', { name: 'Sign out of all devices' }).getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page).toHaveURL(/\/login/);

    // The other browser still holds a correctly signed cookie; it must land on login, not loop.
    await other.goto('/orders');
    await expect(other).toHaveURL(/\/login\?expired=1&next=%2Forders/);
    await expect(other.getByRole('alert').filter({ hasText: 'Your session has expired' })).toBeVisible();
    await otherCtx.close();
  });

  test('admin signs a salesperson out of every device from Sales Force Management', async ({ page, browser }) => {
    const phoneCtx = await browser.newContext();
    const phone = await phoneCtx.newPage();
    await login(phone, 'vishal@erp.com');
    await expect(phone).toHaveURL(/\/field$/);

    await login(page, 'admin@erp.com');
    await page.goto('/salespersons');
    await page.locator('tr', { hasText: 'Vishal Patil' }).getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign out on all devices' });
    await dialog.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Vishal Patil has been signed out on every device.' })).toBeVisible();

    await phone.reload();
    await expect(phone).toHaveURL(/\/login\?expired=1/);
    await phoneCtx.close();
  });

  test('invalid credentials show an error and stay on login', async ({ page }) => {
    await login(page, 'admin@erp.com', 'not-the-password', 'password', false);
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid credentials' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('manager console', () => {
  test('manager sees team-scoped console without admin-only areas', async ({ page }) => {
    const watch = watchErrors(page);
    await login(page, 'manager@erp.com');
    await expect(page).toHaveURL(/\/dashboard$/);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByText('Manager Console')).toBeVisible();

    await page.goto('/settings');
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto('/salespersons');
    await expect(page.getByText('Rahul Sharma').first()).toBeVisible();
    await expect(page.getByText('Vishal Patil')).toHaveCount(0); // not in this manager's team
    watch.assertClean();
  });

  test('salesperson cannot open the console', async ({ page }) => {
    await login(page, 'rahul@erp.com');
    await expect(page).toHaveURL(/\/field$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/field$/);
  });
});
