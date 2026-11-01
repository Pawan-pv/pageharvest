import { defineConfig } from '@playwright/test';
import path from 'path';

const pathToExtension = path.resolve(__dirname, '.output/chrome-mv3');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    headless: false, // Chrome extensions are only fully supported in headful/new-headless Chromium
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true
  },
  webServer: {
    command: 'node tests/fixtures/serve.cjs',
    url: 'http://127.0.0.1:3456/simple-grid.html',
    reuseExistingServer: !process.env.CI,
    timeout: 10000
  }
});
