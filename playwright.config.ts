import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'web-tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // Office baselines: deterministic renders of the lab route compared at a one percent tolerance.
  snapshotPathTemplate: '{testDir}/lab/baselines/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3010',
    screenshot: 'on',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 3010',
        url: 'http://localhost:3010',
        reuseExistingServer: !process.env.CI,
        // The visual suite needs the fixture route; the smoke suite deliberately runs without it.
        env: {
          WORKOS_CLIENT_ID: '',
          NEXT_PUBLIC_CONVEX_URL: '',
          QA_FIXTURE: process.env.QA_FIXTURE ?? '',
        },
      },
});
