import { defineConfig } from '@playwright/test';

/** Pure unit tests: no browser, no web servers. Run with `pnpm test:unit`. */
export default defineConfig({
  testDir: '.',
  testMatch: /\.unit\.spec\.ts$/,
  reporter: [['list']],
});
