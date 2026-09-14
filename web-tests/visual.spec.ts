import { expect, test, type Page } from '@playwright/test';
import { destinations } from '../components/app/nav';
import { slug } from '../lib/text';

/**
 * Photographs the whole interface against the /qa fixture at both viewports and checks the two
 * things a screenshot cannot show: that nothing overflows the viewport horizontally, and that no
 * page error was thrown. The fixture route carries its own identity, so no page error is expected.
 */
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const pages = destinations.map((item) => item.label);

const fixtureEnabled = process.env.QA_FIXTURE === '1';
test.skip(!fixtureEnabled, 'Set QA_FIXTURE=1 to build the fixture route and run the visual suite.');

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The dev overlay sits over the sidebar, so hide it before photographing. */
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
    // Thirteen pages, one of them a 3D scene that settles for four seconds.
    test.slow();
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
      await shoot(page, viewport.name, slug(label));
    }
    expect(errors).toEqual([]);
  });

  test(`every panel and sheet opens inside a ${viewport.width}px viewport`, async ({ page }) => {
    // A dozen navigations, sheets, and full-page screenshots against a development server.
    test.slow();
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
      await shoot(page, viewport.name, `task-${slug(tab)}`);
    }
    await page.getByRole('button', { name: 'Hand off…' }).click();
    await expect(page.getByRole('dialog', { name: 'Hand off this task' })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'handoff-sheet');
    await page.keyboard.press('Escape');

    // Integrations: sharing and access for a connection this viewer owns. A phone folds the row's
    // actions into an overflow menu, so open that first.
    await go(page, 'Integrations', mobile);
    const rowActions = page.getByRole('button', { name: /^Actions for / }).first();
    // The overflow menu's entries are menu items, not buttons.
    const rowAction = (name: string) =>
      mobile
        ? page.getByRole('menuitem', { name, exact: true })
        : page.getByRole('button', { name, exact: true }).first();
    if (mobile) {
      await rowActions.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, 'integration-actions');
    }
    await rowAction('Sharing').click();
    await expect(page.getByRole('dialog', { name: /^Sharing for / })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'sharing-sheet');
    await page.keyboard.press('Escape');
    if (mobile) await rowActions.click();
    await rowAction('Manage access').click();
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

    // The 3D office: the room fills the page and the floor's panels float inside it. A phone reaches
    // the floors through the switcher sheet; so does the desktop, from the chip over the room.
    await go(page, 'Office', mobile);
    await page.locator('.floor-switcher-trigger').first().click();
    await page
      .getByRole('button', { name: /Spring launch/ })
      .first()
      .click();
    await page.locator('canvas').first().waitFor();
    const rail = page.locator('.office-3d-rail');
    if (!(await rail.isVisible())) await page.getByRole('button', { name: 'Show the panel' }).click();
    for (const panel of ['Work', 'Team']) {
      await rail.getByRole('tab', { name: panel, exact: true }).click();
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, `office-3d-${slug(panel)}`);
    }
    // The 2D board lays the same floor out whole.
    await page.locator('.topbar').getByRole('tab', { name: '2D', exact: true }).click();
    await expect(page.locator('.office-2d-floor')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'office-2d');

    if (mobile) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.locator('.sidebar')).toHaveClass(/sidebar-open/);
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, 'navigation-drawer');
    }
    expect(errors).toEqual([]);
  });
}

test('a phone opens a detail and comes back to the list', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const layout = page.locator('.master-detail');

  // Tasks: the list is the whole page until a task is opened, and back returns to it.
  await go(page, 'Tasks', true);
  await expect(layout).toHaveAttribute('data-detail', 'closed');
  await expectNoOverflow(page, 390);
  await shoot(page, 'mobile', 'tasks-list');
  await page
    .getByRole('button', { name: /Draft the migration notes/ })
    .first()
    .click();
  await expect(layout).toHaveAttribute('data-detail', 'open');
  await expectNoOverflow(page, 390);
  await shoot(page, 'mobile', 'tasks-detail');
  await page.goBack();
  await expect(layout).toHaveAttribute('data-detail', 'closed');

  // Inbox and Employees push the same way, and the back header returns to the list.
  await go(page, 'Inbox', true);
  await page.locator('.inbox-list > button').first().click();
  await expect(layout).toHaveAttribute('data-detail', 'open');
  await expectNoOverflow(page, 390);
  await shoot(page, 'mobile', 'inbox-detail');
  await page.locator('.md-back').click();
  await expect(layout).toHaveAttribute('data-detail', 'closed');

  await go(page, 'Team', true);
  await page.locator('.data-table .row-link').first().click();
  await expect(page.locator('.detail-page')).toBeVisible();
  await expectNoOverflow(page, 390);
  await shoot(page, 'mobile', 'employees-detail');
  await page.locator('.detail-back').click();
  await expect(page.locator('.data-table')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a phone reviews pending actions and switches floors without leaving the viewport', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);

  // The review bar is the route to a pending action from anywhere.
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Actions to review' })).toBeVisible();
  await expectNoOverflow(page, 390);
  await shoot(page, 'mobile', 'review-sheet');
  await page.keyboard.press('Escape');

  // Floors: the switcher chip opens the directory over the room; the panel is a drawer.
  await go(page, 'Office', true);
  await page.locator('.floor-switcher-trigger').click();
  await expect(page.getByRole('dialog', { name: 'Floors' })).toBeVisible();
  await expectNoOverflow(page, 390);
  await shoot(page, 'mobile', 'floor-switcher');
  await page
    .getByRole('button', { name: /Spring launch/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Show the panel' }).click();
  await expect(page.locator('.office-3d-rail')).toBeVisible();
  await expectNoOverflow(page, 390);
  await shoot(page, 'mobile', 'floor-panel');
  expect(errors).toEqual([]);
});
