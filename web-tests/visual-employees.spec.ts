import { expect, test, type Page } from '@playwright/test';
import { slug } from '../lib/text';

/**
 * Photographs the employees page, the marketplace, and the marketplace studio against the /qa
 * fixture at both viewports, and checks the two things a screenshot cannot show: that nothing
 * overflows horizontally, and that no page error was thrown. The fixture route carries its own
 * identity, so no page error is expected.
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
    errors.push(error.message);
  });
  return errors;
}

/** The dev overlay sits over the sidebar, so hide it before photographing. */
async function open(page: Page) {
  await page.goto('/qa');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

async function shoot(page: Page, viewport: string, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await page.screenshot({
    path: `test-results/visual-employees/${viewport}-${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

/** A listing's card, found by the name it shows: a phone leaves the cover image out. */
function listingCard(page: Page, name: string) {
  return page
    .locator('.listing-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function go(page: Page, label: string, mobile: boolean) {
  // The phone's navigation drawer sits with the document, so a scrolled page leaves it off-screen.
  await page.evaluate(() => window.scrollTo(0, 0));
  if (mobile) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar-open/);
  }
  const item = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: new RegExp(`^${label}( \\d+)?$`) });
  // A click before the shell hydrates does nothing, so the navigation is the thing asserted.
  await expect(async () => {
    await item.click();
    await expect(page.locator('.topbar')).toContainText(label, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

for (const viewport of viewports) {
  const mobile = viewport.name === 'mobile';

  test(`employees, hiring, and the marketplace render inside a ${viewport.width}px viewport`, async ({
    page,
  }) => {
    // A dozen navigations, sheets, and full-page screenshots against a development server.
    test.slow();
    const errors = watchErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await open(page);

    // Instances grouped by version and floor, with the reserved staff in their own group.
    await go(page, 'Employees', mobile);
    await expect(page.getByRole('heading', { name: 'Hire requests' })).toBeVisible();
    await shoot(page, viewport.name, 'employees');

    // Retired instances are hidden until they are asked for.
    await page.getByLabel(/^Show 1 retired instance$/).check();
    await shoot(page, viewport.name, 'employees-retired');
    await page.getByLabel(/^Show 1 retired instance$/).uncheck();

    // The detail and every tab it carries. Bruno 2 is a version behind, so it has an Upgrade tab.
    await page.getByRole('button', { name: /^Bruno 2/ }).click();
    for (const tab of ['Overview', 'Feed', 'Memory', 'Findings', 'Upgrade', 'Retire']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await shoot(page, viewport.name, `instance-${slug(tab)}`);
    }
    if (mobile) await page.locator('.md-back').click();

    // The hire sheet: a count, the names it would give, and what it adds to capacity and spend.
    await page
      .getByRole('button', { name: 'Hire more' })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: /^Hire 1 instance of / })).toBeVisible();
    await shoot(page, viewport.name, 'hire-sheet');
    await page.getByRole('button', { name: 'One more' }).click();
    await page.getByRole('button', { name: 'One more' }).click();
    await expect(page.getByRole('dialog', { name: /^Hire 3 instances of / })).toBeVisible();
    await shoot(page, viewport.name, 'hire-sheet-three');
    await page.keyboard.press('Escape');

    // The marketplace: counters, the installed shelf, evidence, versions, and the upgrade prompt.
    await go(page, 'Marketplace', mobile);
    await shoot(page, viewport.name, 'marketplace');
    await page.getByRole('button', { name: 'Installed', exact: true }).click();
    await shoot(page, viewport.name, 'marketplace-installed');
    await listingCard(page, 'Bruno').getByRole('button', { name: /View details/ }).click();
    await expect(page.getByRole('dialog', { name: 'Bruno' })).toBeVisible();
    await shoot(page, viewport.name, 'marketplace-detail');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await listingCard(page, 'Ada').getByRole('button', { name: /View details/ }).click();
    await expect(page.getByRole('dialog', { name: 'Ada' })).toBeVisible();
    // Evidence, versions, and the upgrade prompt sit below the gallery inside the sheet's own scroll.
    await page.locator('.sheet-body').evaluate((body) => body.scrollTo(0, body.scrollHeight));
    await shoot(page, viewport.name, 'marketplace-evidence');
    await page.getByRole('button', { name: /^Hire instances$/ }).click();
    await expect(page.getByRole('dialog', { name: /^Hire 1 instance of Ada$/ })).toBeVisible();
    await shoot(page, viewport.name, 'marketplace-hire');
    await page.keyboard.press('Escape');

    // The studio, reached the way an administrator reaches it: from the marketplace itself.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Manage listings' }).click();
    await expect(page.locator('.topbar')).toContainText('Marketplace admin');
    await shoot(page, viewport.name, 'studio');
    await page.getByRole('button', { name: 'Preview' }).first().click();
    for (const tab of ['Listing', 'Instructions', 'Changes']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await shoot(page, viewport.name, `studio-${slug(tab)}`);
    }
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  });
}

test('a phone opens an instance and comes back to the list', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const layout = page.locator('.master-detail');

  await go(page, 'Employees', true);
  await expect(layout).toHaveAttribute('data-detail', 'closed');
  await shoot(page, 'mobile', 'employees-list');
  await page.locator('.employee-card').first().click();
  await expect(layout).toHaveAttribute('data-detail', 'open');
  await shoot(page, 'mobile', 'employees-detail');
  await page.goBack();
  await expect(layout).toHaveAttribute('data-detail', 'closed');
  expect(errors).toEqual([]);
});
