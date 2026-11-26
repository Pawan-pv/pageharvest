import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { expect, test } from './release-test';
import { markTourSeen } from './helpers/panel';

/**
 * The slow-down message comes from a real signal. The fixture server answers the second page
 * with HTTP 429 Too Many Requests; the page reads that status from its own navigation timing,
 * and the job stops where it can continue, with the panel saying why.
 */
const FIXTURES = 'http://127.0.0.1:3456';
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3-test');

interface StoredJob {
  status: string;
  totalExtracted: number;
  errors: { code?: string }[];
}

function readJobs(panel: Page): Promise<StoredJob[]> {
  return panel.evaluate(
    () =>
      new Promise<StoredJob[]>((resolve, reject) => {
        const open = indexedDB.open('PageHarvestDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('jobs').objectStore('jobs').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as StoredJob[]);
          };
        };
      })
  );
}

test.describe('A site that answers 429', () => {
  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  let profile: string;

  test.beforeAll(async () => {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-rate-limit-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    extensionId = worker.url().split('/')[2];
    await markTourSeen(worker);
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  });

  test('stops the job where it can continue, and says the site asked to slow down', async () => {
    const target = await context.newPage();
    await target.goto(`${FIXTURES}/rate-limited-pagination.html`);
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 360, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront();

    await panel.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i }).click();
    await panel.getByRole('button', { name: /Auto-detect on this page/i }).click();
    await expect(panel.getByText(/Found 3 items/)).toBeVisible({ timeout: 20000 });
    await panel.getByRole('button', { name: 'Start Extraction' }).click();

    await expect(panel.getByText('The site asked PageHarvest to slow down')).toBeVisible({ timeout: 45000 });
    await expect(panel.getByRole('button', { name: 'Continue' })).toBeVisible();

    const [job] = await readJobs(panel);
    expect(job.status).toBe('RECOVERABLE');
    expect(job.totalExtracted).toBe(3);
    expect(job.errors.at(-1)?.code).toBe('RATE_LIMITED');
    await target.close();
    await panel.close();
  });
});
