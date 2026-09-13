import { expect, test, type Page } from '@playwright/test';
import { slug } from '../lib/text';

/**
 * Photographs the records basement, the audit room, and every section of the settings panel against
 * the /qa fixture at both viewports, and checks the two things a screenshot cannot show: that
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
    errors.push(error.message);
  });
  return errors;
}

async function open(page: Page) {
  await page.goto('/qa');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

async function shoot(page: Page, viewport: string, name: string) {
  await page.screenshot({
    path: `test-results/visual-records/${viewport}-${name}.png`,
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

  test(`records, audit, and settings render inside a ${viewport.width}px viewport`, async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await open(page);

    // Records: every scope, the conflicts queue, a supersession chain, and the budgets sheet.
    await go(page, 'Records', mobile);
    for (const scope of ['Workspace', 'Projects', 'Floors', 'Notebooks', 'Task summaries']) {
      await page.getByRole('tab', { name: scope }).click();
      // The task summaries tab is worth photographing on a task that actually has a dossier.
      const shelf =
        scope === 'Task summaries'
          ? page.locator('.shelf-list > button').filter({ hasText: 'Write the customer announcement' })
          : page.locator('.shelf-list > button').first();
      if (scope === 'Task summaries' || mobile) await shelf.click();
      await expect(page.locator('.shelf-detail')).toBeVisible();
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, `records-${slug(scope)}`);
      if (mobile) await page.locator('.md-back').click();
    }

    await page.getByRole('tab', { name: 'Floors' }).click();
    if (mobile) await page.locator('.shelf-list > button').first().click();
    await page
      .getByRole('button', { name: /^History/ })
      .first()
      .click();
    await expect(page.locator('.claim-chain')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'records-chain');
    if (mobile) await page.locator('.md-back').click();

    await page.getByRole('button', { name: 'Budgets' }).click();
    await expect(page.getByRole('dialog', { name: 'Memory budgets' })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'records-budgets');
    await page.keyboard.press('Escape');

    // Audit: the escalation strip, a night's documents, and a filtered view.
    await go(page, 'Audit', mobile);
    if (mobile) await page.locator('.night-list > button').first().click();
    await expect(page.locator('.audit-document').first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'audit-night');
    if (mobile) await page.locator('.md-back').click();
    await page.locator('.segmented').getByRole('button', { name: 'Escalated' }).click();
    if (mobile) await page.locator('.night-list > button').first().click();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'audit-escalated');
    if (mobile) await page.locator('.md-back').click();

    // Settings: every section of the panel.
    if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: /Workspace settings/ }).click();
    await expect(page.getByRole('dialog', { name: 'Workspace settings' })).toBeVisible();
    for (const section of ['Workspace', 'Schedule', 'Plan and budgets', 'Policies', 'Standards']) {
      await page.locator('.settings-sections').getByRole('button', { name: section }).click();
      await expect(page.locator('.settings-section')).toContainText(section);
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, `settings-${slug(section)}`);
    }
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  });
}
