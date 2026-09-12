import { test, expect } from '@playwright/test';
test('empty workspace navigation and setup stay usable on desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();
  for (const label of [
    'Inbox',
    'Employees',
    'Tasks',
    'Files',
    'Activity',
    'Marketplace',
    'Integrations',
    'Office',
  ]) {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(page.locator('.topbar')).toContainText(label);
    await page.screenshot({
      path: `test-results/desktop-${label.toLowerCase()}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: 'Workspace settings', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();
  await expect(page.getByText('Before the first real task')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Workspace settings' });
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace settings', exact: false })).toBeFocused();
  expect(errors).toEqual([]);
});
test('mobile navigation keeps every page within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  for (const label of ['Integrations', 'Marketplace', 'Office']) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-open/);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    await page.screenshot({
      path: `test-results/mobile-${label.toLowerCase()}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});
