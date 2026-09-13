import { test, expect } from '@playwright/test';
test('empty workspace navigation and setup stay usable on desktop', async ({ page }) => {
  // Eight pages with full-page screenshots and a five-second office settle on a development server.
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();
  for (const label of ['Work', 'Team', 'Plan', 'Records', 'Integrations', 'Office']) {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(page.locator('.topbar')).toContainText(label);
    if (label === 'Office') {
      await expect(page.getByLabel('Floors')).toBeVisible();
      await page.locator('canvas').waitFor();
      await page.waitForTimeout(5000);
    }
    await page.screenshot({
      path: `test-results/desktop-${label.toLowerCase()}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();
  await expect(page.getByText('Before the first real task')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Workspace settings' });
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
test('mobile navigation keeps every page within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  for (const label of ['Integrations', 'Team', 'Office']) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-open/);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    if (label === 'Office') {
      await expect(page.getByLabel('Floors')).toBeVisible();
      await page.locator('canvas').waitFor();
      await page.waitForTimeout(5000);
    }
    await page.screenshot({
      path: `test-results/mobile-${label.toLowerCase()}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});
