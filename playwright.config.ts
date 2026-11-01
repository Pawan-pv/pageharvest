import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    headless: false, // Chrome extensions are only fully supported in headful/new-headless Chromium
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: 'artifacts/release-testing/playwright',
  webServer: {
    command: 'node tests/fixtures/serve.cjs',
    url: 'http://127.0.0.1:3456/simple-grid.html',
    reuseExistingServer: !process.env.CI,
    timeout: 10000
  }
});
