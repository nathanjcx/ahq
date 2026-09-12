import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'web-tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3010',
    screenshot: 'on',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 3010',
    url: 'http://localhost:3010',
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '', NEXT_PUBLIC_CONVEX_URL: '' },
  },
});
