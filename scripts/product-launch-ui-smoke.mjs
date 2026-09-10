/**
 * Real-App product-launch smoke, in a private browser context (no Electron/account).
 * Run: node scripts/product-launch-ui-smoke.mjs
 * Optional: PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, DEMO_SMOKE_OUTPUT.
 * Uses local Playwright first, then the Codex bundled runtime; no package changes.
 * No recording, clock mocking, fixture route, real API calls, or user browser profile.
 */
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, process.env.DEMO_SMOKE_OUTPUT || 'test-results/product-launch-ui');
async function loadPlaywright() {
  const candidates = process.env.PLAYWRIGHT_MODULE
    ? [process.env.PLAYWRIGHT_MODULE]
    : [
        'playwright',
        pathToFileURL(
          path.join(
            homedir(),
            '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
          ),
        ).href,
      ];
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Playwright is unavailable. Set PLAYWRIGHT_MODULE to an installed playwright/index.mjs.');
}
async function browserExecutable() {
  if (process.env.CHROMIUM_EXECUTABLE) return process.env.CHROMIUM_EXECUTABLE;
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try {
    await access(chrome);
    return chrome;
  } catch {
    return undefined;
  }
}
const { chromium } = await loadPlaywright();
const server = await createServer({ root, server: { port: 0, strictPort: false, host: '127.0.0.1' } });
let browser;
let page;
let model;
const failures = [];
const pageErrors = [];
const failedAssets = [];
let completedAudit;
let finalStorage;
await mkdir(output, { recursive: true });
try {
  await server.listen();
  model = await server.ssrLoadModule('/src/components/demo-tour-model.ts');
  const { initialState, defaultEmployees, STORAGE_KEY } = await server.ssrLoadModule('/src/lib/store.ts');
  const liveState = {
    ...initialState(),
    workspaceName: 'Smoke test live workspace',
    goal: 'Preserve this live launch plan',
    employees: defaultEmployees(() => 0.4).map((employee, index) => ({
      ...employee,
      id: `smoke-live-${index}`,
      name: `Saved teammate ${index + 1}`,
    })),
  };
  browser = await chromium.launch({
    headless: true,
    executablePath: await browserExecutable(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 836 }, deviceScaleFactor: 1 });
  // External connections are unnecessary for this local-only sample.
  await context.route(/^https?:\/\//, (route) => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await context.addInitScript(
    ({ liveState, storageKey }) => {
      localStorage.setItem(storageKey, JSON.stringify(liveState));
      localStorage.setItem('astra-hq:default-roster-v2', 'done');
      localStorage.setItem('demo-smoke-sentinel', 'must survive Start / Reset / Exit');
      const audit = (window.__demoSmoke = {
        armed: false,
        apiCalls: [],
        storageWrites: [],
        clicks: [],
        inputs: {},
        views: [],
        swipes: [],
        photoSelections: [],
        participants: [],
        previews: [],
        images: [],
        cursorSeen: false,
        routes: [],
      });
      const timestamp = () => ({
        wall: performance.now(),
        label: document.querySelector('.demo-mode-label')?.textContent || '',
        page: document.querySelector('.main-shell')?.getAttribute('data-page'),
      });
      for (const method of ['setItem', 'removeItem', 'clear']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (...args) {
          if (this === localStorage && audit.armed) {
            audit.storageWrites.push({ method, key: args[0], ...timestamp() });
            throw new Error(`Demo attempted localStorage.${method}`);
          }
          return original.apply(this, args);
        };
      }
      const nativeSpy = new Proxy(
        {},
        {
          get(_target, method) {
            if (method === 'then') return undefined;
            return (...args) => {
              audit.apiCalls.push({ method: String(method), argumentCount: args.length, ...timestamp() });
              return Promise.reject(new Error(`Demo attempted native API ${String(method)}`));
            };
          },
        },
      );
      window.__armDemoSmoke = () => {
        audit.armed = true;
        window.ahq = nativeSpy;
      };
      window.__disarmDemoSmoke = () => {
        audit.armed = false;
        delete window.ahq;
      };
      document.addEventListener(
        'click',
        (event) => {
          if (!audit.armed || !(event.target instanceof Element)) return;
          const control = event.target.closest('[data-demo-target]');
          const target = control?.getAttribute('data-demo-target');
          if (target)
            audit.clicks.push({
              target,
              officeMarker:
                control instanceof HTMLButtonElement && control.classList.contains('office-review-marker'),
              visible: !!control?.getClientRects().length,
              trusted: event.isTrusted,
              dialog: event.target.closest('[role="dialog"]')?.textContent?.slice(0, 5000) || '',
              ...timestamp(),
            });
        },
        true,
      );
      document.addEventListener(
        'input',
        (event) => {
          const element = event.target;
          if (
            !audit.armed ||
            !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
          )
            return;
          const target = element.getAttribute('data-demo-target');
          if (target) (audit.inputs[target] ||= []).push(element.value);
        },
        true,
      );
      for (const type of ['pointerdown', 'pointerup'])
        document.addEventListener(
          type,
          (event) => {
            if (
              audit.armed &&
              event.target instanceof Element &&
              event.target.closest('[data-demo-target="photo-swipe"]')
            )
              audit.swipes.push({
                type,
                x: event.clientX,
                y: event.clientY,
                pointerId: event.pointerId,
                ...timestamp(),
              });
          },
          true,
        );
      // Include route changes shorter than the visual sampling interval. Recording the old
      // value also catches a Files visit that was changed back before this callback ran.
      new MutationObserver((changes) => {
        if (!audit.armed) return;
        for (const change of changes) {
          if (change.target instanceof Element && change.target.matches('.main-shell'))
            audit.routes.push({
              from: change.oldValue,
              to: change.target.getAttribute('data-page'),
              ...timestamp(),
            });
        }
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-page'],
        attributeOldValue: true,
      });
      const addUnique = (array, value) => {
        if (value && !array.includes(value)) array.push(value);
      };
      setInterval(() => {
        if (!audit.armed) return;
        const now = timestamp();
        const dialog = document.querySelector('[role="dialog"]')?.getAttribute('aria-label') || '';
        const view = `${now.page}:${dialog}`;
        if (audit.views.at(-1)?.view !== view) audit.views.push({ view, ...now });
        audit.cursorSeen ||= !!document.querySelector('.product-launch-cursor');
        document
          .querySelectorAll('.conversation-messages .message-byline strong')
          .forEach((name) => addUnique(audit.participants, name.textContent));
        const selection = document
          .querySelector('.file-photo-thumbnails [aria-pressed="true"]')
          ?.getAttribute('data-demo-target');
        if (selection && audit.photoSelections.at(-1) !== selection) audit.photoSelections.push(selection);
        for (const selector of [
          'employee-name',
          'goal-input',
          'meeting-event',
          'slogan-preview',
          'photo-swipe',
          'landing-page-preview',
        ]) {
          const element = document.querySelector(`[data-demo-target="${selector}"]`);
          if (element?.getClientRects().length) addUnique(audit.previews, selector);
        }
        if (document.querySelector('.file-sheet-preview')) addUnique(audit.previews, 'workbook');
        document.querySelectorAll('.file-photo-viewport img, .file-landing-preview img').forEach((img) => {
          if (img.complete && img.naturalWidth > 0) addUnique(audit.images, img.getAttribute('src'));
        });
      }, 80);
    },
    { liveState, storageKey: STORAGE_KEY },
  );
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/demo/'))
      failedAssets.push({ url: response.url(), status: response.status() });
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole('button', { name: 'Start demo', exact: true }).waitFor();
  await page.locator('canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  const storage = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
  const baseline = await storage();
  const screenshot = async (name) => {
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
    console.log(`Saved ${name}.png`);
  };
  const clock = () => page.getByRole('progressbar', { name: 'Demo progress' }).getAttribute('aria-valuenow');
  const waitElapsed = async (milliseconds) => {
    const seconds = Math.ceil(milliseconds / 1000);
    await page.waitForFunction(
      (seconds) => {
        const progress = document.querySelector('[role="progressbar"][aria-label="Demo progress"]');
        return progress && Number(progress.getAttribute('aria-valuenow')) >= seconds;
      },
      seconds,
      { timeout: model.TOUR_DURATION + 30_000 },
    );
  };
  const assertNoWrites = async (label) => {
    const audit = await page.evaluate(() => window.__demoSmoke);
    assert.deepEqual(audit.apiCalls, [], `${label}: no native API calls in sample mode`);
    assert.deepEqual(audit.storageWrites, [], `${label}: no localStorage mutations in sample mode`);
    assert.deepEqual(await storage(), baseline, `${label}: saved workspace bytes unchanged`);
  };
  await page.evaluate(() => window.__armDemoSmoke());
  await page.getByRole('button', { name: 'Start demo', exact: true }).click();
  await page.locator('[data-demo-active="true"]').waitFor();
  await page.getByRole('region', { name: 'Demo guide' }).waitFor();
  await screenshot('01-intro');
  console.log(`Watching the real ${model.TOUR_DURATION / 1000}s demo.`);
  await waitElapsed(model.tourTime(17000));
  await screenshot('02-office-work');
  await page.getByRole('button', { name: 'Pause demo', exact: true }).click();
  await page.getByRole('button', { name: 'Resume demo', exact: true }).waitFor();
  await page.waitForTimeout(150);
  const frozenClock = await clock();
  const frozenClicks = await page.evaluate(() => window.__demoSmoke.clicks.length);
  await page.waitForTimeout(1600);
  assert.equal(await clock(), frozenClock, 'Pause freezes the visible demo clock');
  assert.equal(
    await page.evaluate(() => window.__demoSmoke.clicks.length),
    frozenClicks,
    'Pause freezes scripted actions',
  );
  await page.getByRole('button', { name: 'Resume demo', exact: true }).click();
  await waitElapsed(model.tourTime(24000));
  await screenshot('03-email-review');
  await waitElapsed(model.tourTime(48000));
  await screenshot('04-marketing-photos');
  await waitElapsed(model.TOUR_DURATION);
  await page.getByRole('button', { name: 'Exit demo', exact: true }).waitFor();
  assert.equal(
    await page.locator('.main-shell').getAttribute('data-page'),
    'office',
    'Demo finishes in Office',
  );
  assert.equal(await page.getByRole('dialog').count(), 0, 'Demo closes its final review');
  await screenshot('05-finished-office');
  await assertNoWrites('Completed run');
  completedAudit = await page.evaluate(() => window.__demoSmoke);
  const scripted = completedAudit.clicks.filter((click) => !click.trusted);
  const targets = scripted.map((click) => click.target);
  for (const target of [
    'employee-new',
    'employee-personality',
    'employee-create',
    'goal-open',
    'goal-save',
    'photo-handoff',
  ]) {
    assert.ok(targets.includes(target), `The actual script clicked ${target}`);
  }
  const markers = scripted.filter((click) => click.target.startsWith('office-review-'));
  assert.deepEqual(
    markers.map((click) => click.target),
    [
      'office-review-assistant', // Email reply.
      'office-review-assistant', // Calendar meeting.
      'office-review-software-engineer', // Pull request.
      'office-review-finance-bro', // Profit workbook.
      'office-review-demo-marketing-intern', // Slogan.
      'office-review-demo-marketing-intern', // Photo choices.
      'office-review-software-engineer', // Landing page.
      'office-review-demo-marketing-intern', // Campaign approval.
    ],
    'Exactly eight scripted employee marker clicks, in the correct actor order',
  );
  for (const marker of markers) {
    assert.equal(marker.officeMarker, true, `${marker.target} is a real office-review-marker button`);
    assert.equal(marker.visible, true, `${marker.target} is visible when clicked`);
    assert.equal(marker.page, 'office', `${marker.target} opens its review from Office`);
  }
  assert.ok(!targets.includes('nav-files'), 'Autoplay never clicks Files navigation');
  assert.ok(
    completedAudit.views.every((view) => view.page !== 'files'),
    'No Files page observed during autoplay',
  );
  assert.ok(
    completedAudit.routes.every((route) => route.from !== 'files' && route.to !== 'files'),
    'Autoplay never visits the Files route, including between visual samples',
  );
  const approvals = scripted.filter((click) => click.target === 'review-approve');
  assert.equal(approvals.length, 3, 'Exactly three real approval-button clicks');
  assert.ok(
    approvals.some((click) => /Thrive Capital/.test(click.dialog)),
    'Email approval dialog opened',
  );
  assert.ok(
    approvals.some((click) => /NaN|pull request/i.test(click.dialog)),
    'PR approval dialog opened',
  );
  assert.ok(
    approvals.some((click) => /campaign/i.test(click.dialog)),
    'Campaign approval dialog opened',
  );
  for (const [target, expected] of [
    ['employee-name', 'Morgan'],
    ['employee-role', 'Marketing Intern'],
    ['goal-input', model.TOUR_GOAL],
  ]) {
    const values = completedAudit.inputs[target] || [];
    assert.ok(values.includes(expected), `${target} finishes typing its expected value`);
    assert.ok(
      values.some((value) => value.length > 0 && value.length < expected.length),
      `${target} visibly types intermediate text`,
    );
  }
  assert.ok(completedAudit.cursorSeen, 'Virtual cursor was visible');
  for (const name of ['Alex', 'Blake', 'Avery', 'Morgan'])
    assert.ok(completedAudit.participants.includes(name), `${name} appears in the real office group chat`);
  for (const preview of [
    'employee-name',
    'goal-input',
    'meeting-event',
    'slogan-preview',
    'photo-swipe',
    'landing-page-preview',
    'workbook',
  ])
    assert.ok(completedAudit.previews.includes(preview), `${preview} was mounted and visible`);
  const starts = completedAudit.swipes.filter((swipe) => swipe.type === 'pointerdown');
  const ends = completedAudit.swipes.filter((swipe) => swipe.type === 'pointerup');
  assert.equal(starts.length, 3, 'Three actual photo swipes started');
  assert.equal(ends.length, 3, 'Three actual photo swipes finished');
  assert.deepEqual(
    ends.map((end, index) => Math.sign(end.x - starts[index].x)),
    [-1, -1, 1],
    'Photos swipe left, left, right',
  );
  assert.deepEqual(
    completedAudit.photoSelections,
    ['photo-option-1', 'photo-option-2', 'photo-option-3', 'photo-option-2'],
    'Three photo choices shown and option 2 selected',
  );
  assert.ok(
    completedAudit.images.some((src) => src.endsWith('marketing-photo-2.png')),
    'Selected image decoded',
  );
  // Inspect all seven completed files with the normal, now-interactive Files page.
  await page.locator('[data-demo-target="nav-files"]').click();
  for (const id of ['meeting', 'email', 'pr', 'profits', 'slogan', 'photo', 'app']) {
    await page.locator(`[data-demo-target="file-${id}"]`).click();
    await page.getByRole('dialog').waitFor();
    await page.locator('[data-demo-target="file-preview-close"]').click();
  }
  assert.equal(
    await page.locator('[data-demo-target^="file-"]').count(),
    7,
    'All seven file controls remain inspectable',
  );
  // Reset prepares the sample without changing the saved live workspace.
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByText('Demo ready', { exact: true }).waitFor();
  assert.equal(await page.locator('.main-shell').getAttribute('data-page'), 'office');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.locator('[data-demo-target="nav-employees"]').click();
  assert.equal(
    await page.locator('.employee-card:not(.new-employee-card)').count(),
    3,
    'Reset removes the intern',
  );
  await page.locator('[data-demo-target="nav-files"]').click();
  assert.equal(await page.locator('[data-demo-target^="file-"]').count(), 0, 'Reset clears sample files');
  await page.locator('[data-demo-target="nav-office"]').click();
  await page.locator('[data-demo-target="goal-open"]').click();
  assert.notEqual(
    await page.locator('[data-demo-target="goal-input"]').inputValue(),
    model.TOUR_GOAL,
    'Reset clears the launch goal',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await assertNoWrites('Reset');
  const replayClickCount = await page.evaluate(() => window.__demoSmoke.clicks.length);
  await page.getByRole('button', { name: 'Start demo', exact: true }).click();
  await page.waitForFunction(
    (before) =>
      window.__demoSmoke.clicks
        .slice(before)
        .some((click) => click.target === 'employee-new' && !click.trusted),
    replayClickCount,
    { timeout: 20_000 },
  );
  const replayClock = await clock();
  assert.ok(Number(replayClock) < model.tourTime(6000) / 1000, 'Replay begins at the hire step');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByText('Demo ready', { exact: true }).waitFor();
  await page.waitForTimeout(250);
  const resetClicks = await page.evaluate(() => window.__demoSmoke.clicks.length);
  await page.waitForTimeout(1000);
  assert.equal(
    await page.evaluate(() => window.__demoSmoke.clicks.length),
    resetClicks,
    'Reset cleans up the previous playback timer',
  );
  assert.equal(await page.getByRole('dialog').count(), 0, 'Reset closes the active hire form');
  assert.equal(await page.locator('.product-launch-cursor').count(), 0, 'Reset removes the old cursor');
  await assertNoWrites('Replay and second reset');
  await page.evaluate(() => window.__disarmDemoSmoke());
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await page.locator('[data-demo-active="false"]').waitFor();
  await page.locator('[data-demo-target="nav-employees"]').click();
  assert.equal(await page.locator('.employee-card:not(.new-employee-card)').count(), 3);
  for (const employee of liveState.employees)
    await page.getByText(employee.name, { exact: true }).first().waitFor();
  await page.locator('[data-demo-target="nav-office"]').click();
  await page.locator('[data-demo-target="goal-open"]').click();
  assert.equal(
    await page.locator('[data-demo-target="goal-input"]').inputValue(),
    liveState.goal,
    'Exit restores the live goal',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  finalStorage = await storage();
  assert.deepEqual(finalStorage, baseline, 'Exit restores the saved live workspace byte-for-byte');
  assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
  assert.deepEqual(failedAssets, [], 'No missing demo assets');
  console.log(
    'PASS: real Start, Pause/Resume, eight employee-marker reviews in Office, all files, three swipes, approvals, Reset/replay, Exit restoration, and API/storage isolation.',
  );
} catch (error) {
  failures.push(error.stack || String(error));
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    completedAudit ||= await page.evaluate(() => window.__demoSmoke).catch(() => undefined);
  }
  process.exitCode = 1;
  console.error(error);
} finally {
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        duration: model?.TOUR_DURATION,
        failures,
        pageErrors,
        failedAssets,
        audit: completedAudit,
        restoredStorage: finalStorage,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await server.close();
}
