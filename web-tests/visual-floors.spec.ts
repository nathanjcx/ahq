import { expect, test, type Page } from '@playwright/test';
import { slug } from '../lib/text';

/**
 * Photographs the lobby, a floor, its channel, feeds, work, team, and binder, then the Triage floor
 * and the notifications ledger, at both viewports. It checks the two things a screenshot cannot show: that
 * nothing overflows horizontally, and that no page error was thrown.
 */
const viewports = [
  { name: 'desktop', width: 1280, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const fixtureEnabled = process.env.QA_FIXTURE === '1';
test.skip(!fixtureEnabled, 'Set QA_FIXTURE=1 to build the fixture route and run the visual suite.');

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!/clerk/i.test(error.message)) errors.push(error.message);
  });
  return errors;
}

async function open(page: Page) {
  await page.goto('/qa');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

async function shoot(page: Page, viewport: string, name: string) {
  await page.screenshot({
    path: `test-results/visual-floors/${viewport}-${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

async function expectNoOverflow(page: Page, width: number) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
}

async function go(page: Page, label: string, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: new RegExp(`^${label}( \\d+)?$`) })
    .click();
  await expect(page.locator('.topbar')).toContainText(label);
}

for (const viewport of viewports) {
  const mobile = viewport.name === 'mobile';

  test(`a floor reads at ${viewport.width}px`, async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await open(page);

    // The incident strip sits above every page while an incident is open.
    await expect(page.locator('.incident-strip')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'incident-strip');

    await go(page, 'Office', mobile);

    // The lobby, before a floor is chosen: the calendar wall for the week ahead and
    // the lift behind it, both from the same subscriptions the floors read.
    await page.locator('canvas').first().waitFor();
    await page.waitForTimeout(3000);
    if (!mobile) await expect(page.locator('.office-calendar')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'lobby');

    if (mobile) await page.locator('.floor-switcher-trigger').click();
    await page
      .getByRole('button', { name: /Spring launch/ })
      .first()
      .click();

    const regionSwitch = page.locator('.floor-region-switch');
    for (const region of ['Board', 'Feeds', 'Work', 'Team', 'Binder']) {
      await regionSwitch.getByRole('button', { name: region, exact: true }).click();
      await expect(page.locator(`.region-${region.toLowerCase()}`)).toBeVisible();
      if (region === 'Team') await page.waitForTimeout(3000);
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, `floor-${slug(region)}`);
    }

    // The day replay takes over the stage and brings its own scrubber.
    await regionSwitch.getByRole('button', { name: 'Team', exact: true }).click();
    await page.getByRole('button', { name: 'Replay the day' }).click();
    await expect(page.locator('.office-day-scrub')).toBeVisible();
    await page.waitForTimeout(2000);
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'floor-day-replay');
    await page.getByRole('button', { name: 'Replay the day' }).click();

    // The unread line, the day separators, and every post kind live in the channel.
    await regionSwitch.getByRole('button', { name: 'Board', exact: true }).click();
    const board = page.locator('.region-board');
    await expect(board.locator('.channel-unread-line')).toBeVisible();
    await expect(board.locator('.channel-post[data-kind="report"]').first()).toBeVisible();
    await expect(board.locator('.channel-post[data-contested="true"]')).toBeVisible();
    await expect(board.locator('.channel-handoff')).toBeVisible();
    await page.getByRole('button', { name: 'Address' }).click();
    await expect(page.getByRole('listbox', { name: /Address this post/ })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'channel-mention');
    expect(errors).toEqual([]);
  });

  test(`triage reads at ${viewport.width}px`, async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    await page.setViewportSize(viewport);
    await open(page);
    await go(page, 'Triage', mobile);

    await expect(page.locator('.alert-row').first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'triage-alerts');

    // The emergency incident: its paging line and the tool call it made without permission.
    // Scoped to the list: the Triage floor above it speaks the same alert's title.
    await page.locator('.alert-row').filter({ hasText: 'Checkout writes are failing' }).click();
    await expect(page.locator('.alert-paging')).toBeVisible();
    await expect(page.locator('.alert-timeline li[data-authority="emergency"]')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'triage-alert-detail');
    if (mobile) await page.locator('.md-back').click();

    for (const tab of ['Incident reports', 'Intake']) {
      await page.locator('.triage-tabs').getByRole('button', { name: tab, exact: true }).click();
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, `triage-${slug(tab)}`);
    }
    await expect(page.locator('.rule-pill').first()).toBeVisible();

    // The notifications ledger, reachable from every page.
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
    await expect(page.locator('.bell-item[data-unread="true"]').first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'notifications');
    expect(errors).toEqual([]);
  });
}
