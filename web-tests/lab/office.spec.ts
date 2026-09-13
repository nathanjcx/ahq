import { expect, test } from '@playwright/test';

/**
 * Office baselines. Run with QA_FIXTURE=1 (`npm run test:lab`). The first run writes the baseline
 * images under web-tests/lab/baselines; later runs fail above a one percent pixel difference. Accept
 * a changed baseline only after looking at it: `npm run test:lab -- --update-snapshots`.
 */
const scenes: { name: string; query: string }[] = [
  { name: 'lobby-day', query: 'preset=lobby&hour=11' },
  { name: 'floor-day', query: 'preset=floor-day&hour=13' },
  { name: 'floor-night', query: 'preset=floor-night&hour=22' },
  { name: 'floor-dots', query: 'preset=floor-day&hour=13&labels=dots' },
  { name: 'floor-celebrate', query: 'preset=floor-celebrate&hour=15' },
  { name: 'floor-props', query: 'preset=floor-props&hour=13' },
  { name: 'after-hours', query: 'preset=after-hours&hour=23' },
  { name: 'lobby-calendar', query: 'preset=lobby-calendar&hour=10' },
  { name: 'records', query: 'preset=records&hour=11' },
  { name: 'boardroom', query: 'preset=boardroom&hour=15' },
  { name: 'triage', query: 'preset=triage&hour=14' },
  { name: 'meeting-live', query: 'preset=meeting-live&hour=15' },
  { name: 'audit-night', query: 'preset=audit-night&hour=23' },
  { name: 'incident', query: 'preset=incident&hour=14' },
  // The replayed day, stopped at three in the afternoon: the incident is open,
  // triage is on it, and the notice from the unanswered pages is by the door.
  { name: 'day-replay', query: 'preset=day-replay&at=15' },
];

test.skip(process.env.QA_FIXTURE !== '1', 'needs QA_FIXTURE=1');

for (const scene of scenes) {
  test(`office baseline: ${scene.name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/office-lab?${scene.query}&seed=1`);
    await page.locator('canvas').waitFor();
    // The scene settles its first frames, label pass, and lighting blend before the shot.
    await page.waitForTimeout(1500);
    await expect(page.locator('main.office-lab')).toHaveScreenshot(`${scene.name}.png`);
  });
}

test('office performance budget', async ({ page }) => {
  test.setTimeout(120_000);
  // The stage is drawn at the viewport's own size here, so the frame time is a
  // measurement of a 1440 canvas rather than of the 1280 one the baselines use.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/office-lab?preset=floor-day&hour=13&seed=1&width=1440&height=860');
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1000);

  // A full floor is the busiest thing the office draws. The plan's budget is 400
  // draw calls; a call is one mesh, plus one more if it casts a shadow, so this
  // is really a budget on how many separate things the room is made of.
  const readout = page.locator('[data-office-stats]');
  await expect
    .poll(async () => Number((await readout.getAttribute('data-office-stats')) || 0), { timeout: 20_000 })
    .toBeGreaterThan(0);
  const calls = Number(await readout.getAttribute('data-office-stats'));
  expect(calls, 'draw calls on a floor at 1440').toBeLessThan(400);

  const sample = await page.evaluate(
    () =>
      new Promise<{ medianMs: number; frames: number }>((resolve) => {
        const durations: number[] = [];
        let last = performance.now();
        const tick = () => {
          const now = performance.now();
          durations.push(now - last);
          last = now;
          if (durations.length < 20) requestAnimationFrame(tick);
          else {
            const sorted = [...durations].sort((a, b) => a - b);
            resolve({ medianMs: sorted[Math.floor(sorted.length / 2)], frames: durations.length });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  // Software rendering has no GPU; LAB_FRAME_BUDGET_MS=16 is the budget on a machine
  // with one. The fallback is a guard against a collapse under SwiftShader, sized for
  // the 1440 canvas this draws, not the plan's budget.
  expect(sample.medianMs, 'median frame time').toBeLessThan(Number(process.env.LAB_FRAME_BUDGET_MS ?? 1_000));
});
