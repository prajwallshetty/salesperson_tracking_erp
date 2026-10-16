import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('console is usable on a phone: navigation drawer opens and closes', async ({ page }) => {
  await login(page, 'admin@erp.com');
  await expect(page).toHaveURL(/\/dashboard$/);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).not.toBeInViewport();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(nav).toBeInViewport();
  await nav.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Product Catalog & Inventory' })).toBeVisible();
  await expect(nav).not.toBeInViewport();
  // No horizontal page overflow at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
