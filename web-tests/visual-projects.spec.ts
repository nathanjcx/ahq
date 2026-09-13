import { expect, test, type Page } from '@playwright/test';
import { slug } from '../lib/text';

/**
 * Photographs the Projects page against the /qa fixture at both viewports: the list, a project that
 * is running, a roadmap awaiting review with its bottleneck questions, a planner still working, and
 * the new-project sheet. It checks the two things a screenshot cannot show — that nothing overflows
 * the viewport sideways, and that no page error was thrown.
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

async function shoot(page: Page, viewport: string, name: string) {
  await page.screenshot({
    path: `test-results/visual-projects/${viewport}-${slug(name)}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

async function expectNoOverflow(page: Page, width: number) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
}

/** Opens the fixture workspace on the Projects page. */
async function openProjects(page: Page, mobile: boolean) {
  await page.goto('/qa');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: /^Projects( \d+)?$/ })
    .click();
  await expect(page.locator('.topbar')).toContainText('Projects');
}

const openProject = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) }).click();

for (const viewport of viewports) {
  const mobile = viewport.name === 'mobile';

  test(`the projects pages render inside a ${viewport.width}px viewport`, async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openProjects(page, mobile);

    // The list, with the project that is running selected on a desktop.
    await expect(page.locator('.project-card').first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'list');

    // A project as it runs: roadmap, held-up work, milestones, channel.
    await openProject(page, 'Spring launch');
    await expect(page.locator('.project-detail')).toBeVisible();
    await expect(page.locator('.roadmap-bar').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run it anyway' }).first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'project');

    // The roadmap under review, with the planner's questions and their answer controls.
    if (mobile) await page.locator('.md-back').click();
    await openProject(page, 'Billing migration');
    await expect(page.locator('.roadmap-review')).toBeVisible();
    await expect(page.locator('.question-card')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Hire' }).first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'proposal');

    // The planner still working on a project created a moment ago.
    if (mobile) await page.locator('.md-back').click();
    await openProject(page, 'Onboarding refresh');
    await expect(page.locator('.planner-working')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'planner-working');

    // Finished and archived projects, behind the All filter.
    if (mobile) await page.locator('.md-back').click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.locator('.project-card')).toHaveCount(5);
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'all');

    // The new-project flow.
    await page.getByRole('button', { name: 'New project' }).first().click();
    await expect(page.getByRole('dialog', { name: 'New project' })).toBeVisible();
    await page.getByRole('checkbox').first().check();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'new-project');
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  });
}

test('a phone opens a project and comes back to the list', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openProjects(page, true);
  const layout = page.locator('.master-detail');

  await expect(layout).toHaveAttribute('data-detail', 'closed');
  await openProject(page, 'Spring launch');
  await expect(layout).toHaveAttribute('data-detail', 'open');
  // The timeline is the only thing that scrolls sideways, and it does so inside its own frame.
  const scrolled = await page
    .locator('.roadmap-scroll')
    .first()
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrolled).toBe(true);
  await expectNoOverflow(page, 390);
  await page.goBack();
  await expect(layout).toHaveAttribute('data-detail', 'closed');
  expect(errors).toEqual([]);
});
