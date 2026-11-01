import { promises as fs } from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';

type BrowserDiagnostic = {
  kind: 'console-error' | 'page-error' | 'request-failed';
  message: string;
  url: string;
  method?: string;
};

type ReleaseFixtures = {
  releaseDiagnostics: void;
};

/**
 * Captures browser-side failures for every release E2E test. The report is
 * attached to the test result even when the assertions pass, so a release
 * run has evidence for silent console/page/request failures as well.
 */
export const test = base.extend<ReleaseFixtures>({
  releaseDiagnostics: [async ({ context }, use, testInfo) => {
    const diagnostics: BrowserDiagnostic[] = [];
    const attachedPages = new WeakSet<object>();

    const attachPage = (page: Page) => {
      if (attachedPages.has(page)) return;
      attachedPages.add(page);
      page.on('console', (message) => {
        if (message.type() === 'error') {
          diagnostics.push({
            kind: 'console-error',
            message: message.text(),
            url: page.url(),
          });
        }
      });
      page.on('pageerror', (error) => {
        diagnostics.push({
          kind: 'page-error',
          message: error.message,
          url: page.url(),
        });
      });
      page.on('requestfailed', (request) => {
        diagnostics.push({
          kind: 'request-failed',
          message: request.failure()?.errorText ?? 'Request failed without an error message.',
          url: request.url(),
          method: request.method(),
        });
      });
    };

    context.pages().forEach(attachPage);
    context.on('page', attachPage);

    await use();

    context.off('page', attachPage);

    const diagnosticsPath = testInfo.outputPath('browser-diagnostics.json');
    await fs.writeFile(diagnosticsPath, JSON.stringify({
      test: testInfo.titlePath,
      capturedAt: new Date().toISOString(),
      diagnostics,
    }, null, 2), 'utf8');
    await testInfo.attach('browser-diagnostics', {
      path: diagnosticsPath,
      contentType: 'application/json',
    });
  }, { auto: true }],
});

export { expect };
