import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const server = await createServer({ server: { port: 0, strictPort: false, host: '127.0.0.1' } });
await server.listen();
await mkdir('test-results', { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}scripts/fixtures/launch-ui.html`);
  await page.getByRole('button', { name: 'Start the launch', exact: true }).click();
  await page.getByRole('button', { name: 'Forecast', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByText('Investor revenue assumptions').waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: /3. Screenshot bug/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).count(), 0);
  await page.evaluate(() => window.readyScene(1));
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /2. Investor email/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.equal(await page.evaluate(() => window.check.actions.at(-1).scene), 'investor');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.equal(await page.evaluate(() => window.check.actions.at(-1).scene), 'bug');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.equal(await page.evaluate(() => window.check.actions.at(-1).scene), 'reporter');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Little Office is live' }).waitFor();
  assert.equal(await page.evaluate(() => window.check.events), 1);
  assert.equal(await page.locator('[data-celebrating=true]').count(), 1);
  await page.screenshot({ path: 'test-results/launch-ui-celebrating.png' });
  await page.evaluate(() => window.slap());
  await page.getByText('SLAP!', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/launch-ui-slap.png' });
  await page.waitForTimeout(8500);
  assert.equal(await page.locator('[data-celebrating=true]').count(), 0);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('ahq:celebrate', { detail: { id: 'party-1' } })),
  );
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-celebrating=true]').count(), 0);
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ce3939';
    ctx.fillRect(0, 0, 120, 80);
    window.check.demo.notifications = [
      {
        id: 'bug',
        kind: 'slack',
        title: 'Launch button broken',
        status: 'completed',
        receivedAt: new Date().toISOString(),
        content: 'Screenshot attached',
        attachments: [
          {
            name: 'bug.png',
            mediaType: 'image/png',
            encoding: 'base64',
            content: canvas.toDataURL().split(',')[1],
          },
        ],
      },
    ];
  });
  await page.getByRole('button', { name: /Live office/ }).click();
  await page.waitForTimeout(1200);
  await page.getByText(/Notifications & saved work/).click();
  await page.getByText('bug.png', { exact: true }).click();
  const img = page.getByRole('img', { name: 'bug.png' });
  await img.waitFor();
  assert.equal(await img.evaluate((el) => el.complete && el.naturalWidth === 120), true);
  await page.screenshot({ path: 'test-results/launch-ui-reviewed.png' });
  const before = await page.evaluate(() => window.check.refreshes);
  await page.getByText('Restore a checkpoint').click();
  await page.getByRole('button', { name: /Launch ready/ }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.check.refreshes)) > before);
  assert.equal(await page.getByText('Launch button broken', { exact: true }).count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('ahq:celebrate', { detail: { id: 'party-reduced' } })),
  );
  await page.getByRole('status').filter({ hasText: 'Little Office is live' }).waitFor();
  await page.screenshot({ path: 'test-results/launch-ui-reduced.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: scene gates, named parallel streams, all advances, checkpoint refresh, removed stale source, actual PNG decode, 8s celebration, dedup, reduced motion.',
  );
} finally {
  await browser?.close();
  await server.close();
}
