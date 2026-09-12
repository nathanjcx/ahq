import { expect, test, type Page } from '@playwright/test';
import { nav } from '../components/app/nav';

/**
 * Photographs the whole interface against the /qa fixture at both viewports and checks the two
 * things a screenshot cannot show: that nothing overflows the viewport horizontally, and that no
 * page error was thrown. Clerk cannot reach its fake instance here, so its own failures are ignored.
 */
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const pages = [...nav.map((item) => item.label), 'Marketplace admin', 'Operations'];

const fixtureEnabled = process.env.QA_FIXTURE === '1';
test.skip(!fixtureEnabled, 'Set QA_FIXTURE=1 to build the fixture route and run the visual suite.');

function isClerkError(message: string) {
  return /clerk/i.test(message);
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!isClerkError(error.message)) errors.push(error.message);
  });
  return errors;
}

/** The dev overlay sits over the sidebar and reports the fake Clerk instance as an issue. */
async function open(page: Page) {
  await page.goto('/qa');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

async function shoot(page: Page, viewport: string, name: string) {
  await page.screenshot({
    path: `test-results/visual/${viewport}-${name}.png`,
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
  // Navigation buttons carry a count badge, so "Inbox" reads as "Inbox 1".
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: new RegExp(`^${label}( \\d+)?$`) })
    .click();
  await expect(page.locator('.topbar')).toContainText(label);
}

for (const viewport of viewports) {
  const mobile = viewport.name === 'mobile';

  test(`every page renders inside a ${viewport.width}px viewport`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await open(page);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeAttached();

    for (const label of pages) {
      await go(page, label, mobile);
      if (label === 'Office') {
        await page.locator('canvas').first().waitFor();
        await page.waitForTimeout(4000);
      }
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, label.toLowerCase().replace(/\s+/g, '-'));
    }
    expect(errors).toEqual([]);
  });

  test(`every panel and sheet opens inside a ${viewport.width}px viewport`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await open(page);

    // Task detail: the Actions and Audit tabs, then the handoff sheet.
    await go(page, 'Tasks', mobile);
    await page
      .getByRole('button', { name: /Draft the migration notes/ })
      .first()
      .click();
    for (const tab of ['Actions', 'Audit', 'Conversation']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, `task-${tab.toLowerCase()}`);
    }
    await page.getByRole('button', { name: 'Hand off…' }).click();
    await expect(page.getByRole('dialog', { name: 'Hand off this task' })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'handoff-sheet');
    await page.keyboard.press('Escape');

    // Integrations: sharing and access for a connection this viewer owns.
    await go(page, 'Integrations', mobile);
    await page.getByRole('button', { name: 'Sharing', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: /^Sharing for / })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'sharing-sheet');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Manage access', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: /^Manage / })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'manage-access');
    await page.keyboard.press('Escape');

    // The New task panel, reachable from the top bar on every page.
    await page.getByRole('button', { name: 'New task', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Assign new work' })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'new-task');
    await page.keyboard.press('Escape');

    // The floor's Work and Team regions.
    await go(page, 'Office', mobile);
    await page
      .getByRole('button', { name: /Spring launch/ })
      .first()
      .click();
    // Narrow viewports show one floor region at a time behind a switch; wide ones show them together.
    const regionSwitch = page.locator('.floor-region-switch');
    for (const region of ['Work', 'Team']) {
      if (await regionSwitch.isVisible())
        await regionSwitch.getByRole('button', { name: region, exact: true }).click();
      await expect(page.locator(`.region-${region.toLowerCase()}`)).toBeVisible();
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, `floor-${region.toLowerCase()}`);
    }

    if (mobile) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.locator('.sidebar')).toHaveClass(/sidebar-open/);
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, 'navigation-drawer');
    }
    expect(errors).toEqual([]);
  });
}
