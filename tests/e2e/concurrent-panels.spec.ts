import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { expect, test } from './release-test';
import { enableAdvancedOptions, markTourSeen, startListExtraction } from './helpers/panel';

/**
 * Two side panels on one job, in real Chromium with the built extension. Chrome keeps one
 * side panel per window, so a person can watch a job in one window and act on it in another.
 * Each panel is opened as a tab here, because Playwright cannot click browser chrome.
 *
 * The job is paused after its first page, which keeps it executing for as long as the test
 * needs: page 2 is answered a few seconds late, so the pause lands while the job is between
 * pages, whatever this machine's speed.
 *
 * Regression checks for the audit fixes:
 * - a list cannot be deleted while its job can still write to it (storage refuses, the panel
 *   says why) and can be deleted once the job has ended;
 * - a panel following a job that another panel stopped does not keep showing it as running.
 */
const FIXTURES = 'http://127.0.0.1:3456';
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3-test');

interface StoredJob {
  id: string;
  status: string;
  datasetId: string;
  totalExtracted: number;
}

function readTable<T>(panel: Page, table: string): Promise<T[]> {
  return panel.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('PageHarvestDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(name).objectStore(name).getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            db.close();
            resolve(request.result as T[]);
          };
        };
      }),
    table
  );
}

async function newestJob(panel: Page): Promise<StoredJob> {
  const jobs = await readTable<StoredJob & { startedAt: number }>(panel, 'jobs');
  return jobs.sort((a, b) => b.startedAt - a.startedAt)[0];
}

test.describe('Two panels on one job', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  let profile: string;

  test.beforeAll(async () => {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-panels-profile-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    extensionId = worker.url().split('/')[2];
    await markTourSeen(worker);
    // Page 2 arrives late, so the job is still between pages when it is paused.
    await context.route('**/next-page-p2.html', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      await route.continue().catch(() => undefined);
    });
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  });

  async function openPanel(): Promise<Page> {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 360, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    return panel;
  }

  test('a list being collected is not deleted from another window; it is once the job ends', async () => {
    const target = await context.newPage();
    await target.goto(`${FIXTURES}/next-page-pagination.html`);
    const watching = await openPanel();
    await target.bringToFront();

    await startListExtraction(watching);
    await expect(watching.getByText(/Found 3 items/)).toBeVisible({ timeout: 20000 });
    await watching.getByRole('button', { name: 'Start Extraction' }).click();
    await expect(watching.getByText('Live Extraction Stage')).toBeVisible({ timeout: 20000 });
    await watching.getByRole('button', { name: 'Pause' }).click();
    await expect(watching.getByText('Paused', { exact: true })).toBeVisible({ timeout: 15000 });
    const job = await newestJob(watching);
    expect(job.status).toBe('PAUSED');

    // The other window's panel: My data lists the list being collected, with Delete.
    const other = await openPanel();
    await other.getByRole('button', { name: 'Data', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'My data' })).toBeVisible();
    const datasetsBefore = (await readTable(other, 'datasets')).length;
    await other.getByRole('button', { name: /^Delete / }).first().click();
    await other.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(other.getByText('Not deleted yet')).toBeVisible();
    await expect(other.getByText('This list is still being collected. Stop it first, then delete it.')).toBeVisible();
    expect(await readTable(other, 'datasets')).toHaveLength(datasetsBefore);
    expect((await newestJob(other)).status).toBe('PAUSED');

    // The first panel stops the job, keeping its rows. Now the list can go.
    await watching.getByRole('button', { name: 'Stop extraction' }).click();
    await expect(watching.getByRole('heading', { name: 'Extraction complete' })).toBeVisible({ timeout: 20000 });
    expect((await newestJob(watching)).status).toBe('COMPLETED');

    await other.reload();
    await other.getByRole('button', { name: 'Data', exact: true }).click();
    await other.getByRole('button', { name: /^Delete / }).first().click();
    await other.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await readTable(other, 'datasets')).length).toBe(datasetsBefore - 1);
    const records = await readTable<{ datasetId: string }>(other, 'records');
    expect(records.filter((row) => row.datasetId === job.datasetId)).toHaveLength(0);

    await Promise.all([target.close(), watching.close(), other.close()]);
  });

  test('a panel watching a job that another window cancelled stops showing it as running', async () => {
    await enableAdvancedOptions(worker);
    const target = await context.newPage();
    await target.goto(`${FIXTURES}/next-page-pagination.html`);
    const watching = await openPanel();
    await target.bringToFront();

    // Advanced options: the detailed flow, which has "Cancel job".
    await watching.getByRole('button', { name: 'Find Data on This Page', exact: true }).click();
    await watching.getByRole('button', { name: 'Use this list', exact: true }).click();
    await watching.getByText('Choose your columns').waitFor({ timeout: 20000 });
    const next = watching.getByRole('button', { name: 'Next: Pagination' });
    if (await next.isVisible()) await next.click();
    await watching.getByRole('radio', { name: 'Click a Next button' }).check();
    await watching.getByRole('button', { name: /Start extraction/ }).click();
    await expect(watching.getByText('Collecting rows…')).toBeVisible({ timeout: 20000 });
    await watching.getByRole('button', { name: 'Pause' }).click();
    await expect(watching.getByText('Extraction paused')).toBeVisible({ timeout: 15000 });

    // The other window's panel opens on the same job and cancels it.
    const other = await openPanel();
    await expect(other.getByText('Extraction paused')).toBeVisible({ timeout: 15000 });
    await other.getByRole('button', { name: 'Cancel job' }).click();
    await other.getByRole('button', { name: 'Cancel job' }).click();
    await expect.poll(async () => (await newestJob(other)).status).toBe('CANCELLED');

    // The watching panel lets go of the job and says the rows are kept.
    await expect(watching.getByText('Collecting was stopped. The rows collected so far are saved in My data.')).toBeVisible({
      timeout: 10000,
    });
    await expect(watching.getByText('Extraction paused')).toHaveCount(0);
    await expect(watching.getByRole('button', { name: 'Resume' })).toHaveCount(0);

    await Promise.all([target.close(), watching.close(), other.close()]);
  });
});
