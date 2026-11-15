import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { expect, test } from './release-test';
import { markTourSeen } from './helpers/panel';

/**
 * A list belongs to the tab and the page it was found on. In real Chromium with the built
 * extension: find a list on tab A, switch to tab B, and Start must not collect from tab B
 * with tab A's list. Coming back to tab A makes the list usable again.
 *
 * The side panel is opened as a tab, because Playwright cannot click browser chrome. The
 * panel follows whichever page tab is in front, exactly as the docked panel follows the
 * active tab.
 */
const FIXTURES = 'http://127.0.0.1:3456';
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3-test');

interface StoredJob {
  status: string;
  tabId: number;
  targetUrl: string;
  totalExtracted: number;
}

function readJobs(panel: Page): Promise<StoredJob[]> {
  return panel.evaluate(
    () =>
      new Promise<StoredJob[]>((resolve, reject) => {
        const open = indexedDB.open('PageHarvestDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('jobs')) {
            db.close();
            resolve([]);
            return;
          }
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

test.describe('A found list stays with its tab', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  let profile: string;

  test.beforeAll(async () => {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-tab-binding-'));
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

  test('Start refuses a list found on another tab, and works again back on that tab', async () => {
    const tabA = await context.newPage();
    await tabA.goto(`${FIXTURES}/twenty-cards.html`);
    const tabB = await context.newPage();
    await tabB.goto(`${FIXTURES}/job-listings.html`);
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 360, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Find the list on tab A.
    await tabA.bringToFront();
    await panel.getByRole('button', { name: 'Get the list on this page' }).click();
    await expect(panel.getByRole('heading', { name: 'We found 20 items on this page' })).toBeVisible({ timeout: 20000 });
    await panel.getByRole('button', { name: 'Yes, this is my list' }).click();
    await expect(panel.getByRole('heading', { name: 'Check your columns' })).toBeVisible();

    // Switch to tab B. The panel says the list is on the other tab, and Start does nothing there.
    await tabB.bringToFront();
    await expect(panel.getByText('This list is on another tab')).toBeVisible({ timeout: 10000 });
    const start = panel.getByRole('button', { name: 'Start collecting' });
    if (await start.isVisible()) {
      await expect(start).toBeDisabled();
    }
    expect(await readJobs(panel)).toEqual([]);

    // "Go back to that tab" brings tab A to the front, and the same list is usable again.
    await panel.getByRole('button', { name: 'Go back to that tab' }).click();
    await expect.poll(() => tabA.evaluate(() => document.visibilityState), { timeout: 10000 }).toBe('visible');
    await expect(panel.getByText('This list is on another tab')).toHaveCount(0, { timeout: 10000 });
    await expect(panel.getByRole('button', { name: 'Start collecting' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Start collecting' }).click();
    await expect(panel.getByRole('heading', { name: 'Done. 20 rows collected' })).toBeVisible({ timeout: 30000 });

    const jobs = await readJobs(panel);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].targetUrl).toBe(`${FIXTURES}/twenty-cards.html`);
    expect(jobs[0]).toMatchObject({ status: 'COMPLETED', totalExtracted: 20 });

    await tabA.close();
    await tabB.close();
    await panel.close();
  });

  test('a list is dropped, with a message, when its page is replaced', async () => {
    const tabA = await context.newPage();
    await tabA.goto(`${FIXTURES}/twenty-cards.html`);
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 360, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await tabA.bringToFront();

    await panel.getByRole('button', { name: 'Get the list on this page' }).click();
    await expect(panel.getByRole('heading', { name: 'We found 20 items on this page' })).toBeVisible({ timeout: 20000 });
    await panel.getByRole('button', { name: 'Yes, this is my list' }).click();
    await expect(panel.getByRole('heading', { name: 'Check your columns' })).toBeVisible();

    await tabA.goto(`${FIXTURES}/job-listings.html`);
    await expect(panel.getByText('The page changed, so the list you found is gone')).toBeVisible({ timeout: 10000 });
    await expect(panel.getByRole('button', { name: 'Get the list on this page' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Start collecting' })).toHaveCount(0);

    await tabA.close();
    await panel.close();
  });
  test('closing the panel stops the picker: the overlay goes and the page clicks again', async () => {
    const tabA = await context.newPage();
    await tabA.goto(`${FIXTURES}/twenty-cards.html`);
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 360, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await tabA.bringToFront();

    await panel.getByRole('button', { name: 'Pick one item myself' }).click();
    await expect(panel.getByRole('heading', { name: 'Click one item on the page' })).toBeVisible({ timeout: 15000 });
    const firstLink = tabA.locator('a[href]').first();
    await firstLink.hover();
    await expect(tabA.locator('#pageharvest-picker-overlay-host')).toHaveCount(1, { timeout: 10000 });

    await panel.close();

    await expect(tabA.locator('#pageharvest-picker-overlay-host')).toHaveCount(0, { timeout: 10000 });
    const before = tabA.url();
    await firstLink.click();
    await expect.poll(() => tabA.url(), { timeout: 10000 }).not.toBe(before);
    await tabA.close();
  });
});
