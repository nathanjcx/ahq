import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Tests import components that use the app's `@/` alias, so mirror tsconfig here.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['web-tests/**/*.test.ts'], environment: 'node' },
});
