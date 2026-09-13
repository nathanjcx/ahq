import { expect, test, type Page } from '@playwright/test';
import { slug } from '../lib/text';

/**
 * Photographs the calendar and the boardroom against the /qa fixture at both viewports, and checks
 * the two things a screenshot cannot show: that nothing overflows horizontally, and that no page
 * error was thrown. The fixture route carries its own identity, so no page error is expected.
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
    path: `test-results/visual-calendar/${viewport}-${slug(name)}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

async function expectNoOverflow(page: Page, width: number) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
}

async function goToCalendar(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: /^Calendar( \d+)?$/ })
    .click();
  await expect(page.locator('.topbar')).toContainText('Calendar');
}

for (const viewport of viewports) {
  const mobile = viewport.name === 'mobile';

  test(`the calendar and the boardroom render inside a ${viewport.width}px viewport`, async ({ page }) => {
    test.slow();
    const errors = watchErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await open(page);
    await goToCalendar(page, mobile);

    // The week: rows per instance on a wide screen, the agenda list on a phone.
    await expect(page.locator(mobile ? '.cal-agenda' : '.cal-week')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'week');

    // The day, with working hours shaded and the hour now marked.
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await expect(page.locator(mobile ? '.cal-agenda' : '.cal-day')).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'day');

    // A working day, opened from the week's own heading, with its hours shaded.
    if (!mobile) {
      await page.getByRole('button', { name: 'Week', exact: true }).click();
      await page.getByRole('button', { name: /^Open Wednesday/ }).click();
      await expect(page.locator('.cal-shade').first()).toBeVisible();
      await expectNoOverflow(page, viewport.width);
      await shoot(page, viewport.name, 'day-working');
      // Back to today, where the fixture's three meetings are.
      await page.getByRole('button', { name: 'Today', exact: true }).click();
    }

    // Scheduling: attendees, the hours warning, and the agenda suggested for the time chosen.
    await page.getByRole('button', { name: 'Schedule meeting' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Schedule a meeting' })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'schedule-sheet');
    await page.keyboard.press('Escape');

    // A meeting in session: preparation, transcript, per-question tokens, and the composer.
    await page
      .getByRole('button', { name: /Spring launch review/ })
      .first()
      .click();
    await expect(page.locator('.meeting-view')).toBeVisible();
    await expect(page.locator('.meeting-state')).toHaveText('In session');
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'meeting-live');

    // Preparation is folded away until it is wanted.
    await page.locator('.meeting-report > summary').first().click();
    await expect(page.locator('.meeting-report[open]').first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'meeting-prep');

    // A closed meeting: outcomes waiting on a person, and the one already confirmed.
    await page.locator('.meeting-head .text-button').first().click();
    await page
      .getByRole('button', { name: /February retrospective/ })
      .first()
      .click();
    await expect(page.locator('.meeting-outcome').first()).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'meeting-closed');

    // A meeting nobody has opened yet offers to open itself.
    await page.locator('.meeting-head .text-button').first().click();
    await page
      .getByRole('button', { name: /Launch stand-up/ })
      .first()
      .click();
    await expect(page.getByRole('button', { name: 'Open the boardroom' })).toBeVisible();
    await expectNoOverflow(page, viewport.width);
    await shoot(page, viewport.name, 'meeting-scheduled');

    expect(errors).toEqual([]);
  });
}
