import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import JSZip from 'jszip';
import { expect, test } from './release-test';
import { markTourSeen, waitForCompletedDownload } from './helpers/panel';

/**
 * Simple mode, the mode a new user gets (ADR-039), in real Chromium with the built
 * extension: real service worker, real content script, real IndexedDB and a real download.
 * Advanced options is never switched on here.
 *
 * The side panel is opened as a tab, because Playwright cannot click browser chrome.
 */
const FIXTURES = 'http://127.0.0.1:3456';
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3-test');

interface StoredJob {
  status: string;
  totalExtracted: number;
  pagesVisited: number;
  datasetId: string;
  schema: { pagination: { type: string; maxPages?: number }; fields: { name: string }[] };
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

test.describe('Simple mode', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  let profile: string;
  let downloads: string;
  /** Every request a panel page made to anything but the extension's own files. */
  let panelRequests: string[];

  test.beforeAll(async () => {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-simple-profile-'));
    downloads = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-simple-downloads-'));
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      acceptDownloads: true,
      downloadsPath: downloads,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    extensionId = worker.url().split('/')[2];
    // The tour has its own spec. Advanced options is left as a new user finds it: off.
    await markTourSeen(worker);
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(downloads, { recursive: true, force: true }).catch(() => undefined);
  });

  test.beforeEach(() => {
    panelRequests = [];
  });

  async function open(url: string): Promise<{ target: Page; panel: Page }> {
    const target = await context.newPage();
    await target.goto(url);
    await target.waitForLoadState('domcontentloaded');
    const panel = await context.newPage();
    // The extension's own files, and the file it builds in memory to hand to Chrome's
    // download manager, are not the network.
    const own = [`chrome-extension://${extensionId}/`, `blob:chrome-extension://${extensionId}/`, 'data:'];
    panel.on('request', (request) => {
      if (!own.some((prefix) => request.url().startsWith(prefix))) panelRequests.push(request.url());
    });
    await panel.setViewportSize({ width: 360, height: 800 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront();
    return { target, panel };
  }

  test('a new user is in simple mode: one button, and no word from the code', async () => {
    const { target, panel } = await open(`${FIXTURES}/twenty-cards.html`);
    await expect(panel.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i })).toBeEnabled({ timeout: 15000 });
    await expect(panel.getByRole('button', { name: 'Find data automatically' })).toHaveCount(0);
    await expect(panel.getByText('Ready')).toBeVisible();
    // Nothing is saved yet, so there is no empty "recent data" box, and no version badge.
    await expect(panel.getByText('Nothing saved yet')).toHaveCount(0);
    await expect(panel.getByText(/^v\d/)).toHaveCount(0);
    expect(await panel.locator('body').innerText()).not.toMatch(/selector|schema|recipe|dataset|IndexedDB|extract/i);
    await target.close();
    await panel.close();
  });

  test('collects a list and saves an Excel file that holds every row (T1)', async () => {
    const { target, panel } = await open(`${FIXTURES}/twenty-cards.html`);

    await panel.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i }).click();
    await expect(panel.getByRole('heading', { name: 'We found 20 items on this page' })).toBeVisible({ timeout: 20000 });
    await expect(panel.getByRole('table', { name: 'The first rows' })).toContainText('Item 01 - Alpha Pro Headset');

    await panel.getByRole('button', { name: 'Yes, this is my list' }).click();
    await expect(panel.getByRole('heading', { name: 'Check your columns' })).toBeVisible();
    // The page has no Next button, so "just this page" is the answer already chosen.
    await expect(panel.getByRole('radio', { name: 'No, just this page' })).toBeChecked();

    await panel.getByRole('button', { name: 'Start collecting' }).click();
    await expect(panel.getByRole('heading', { name: 'Done. 20 rows collected' })).toBeVisible({ timeout: 30000 });

    const [job] = await readTable<StoredJob>(panel, 'jobs');
    expect(job).toMatchObject({ status: 'COMPLETED', totalExtracted: 20, pagesVisited: 1 });
    const rows = (await readTable<Record<string, unknown>>(panel, 'records')).filter((row) => row.datasetId === job.datasetId);
    expect(rows).toHaveLength(20);

    // One click, no "Save as" window: Chrome writes the file, and the panel names it.
    const before = await panel.evaluate(async () => (await chrome.downloads.search({})).map((item) => item.id));
    await panel.getByRole('button', { name: 'Download for Excel' }).click();
    const saved = await waitForCompletedDownload(panel, before);
    // An automated browser stores a download under a name of its own, so the name asked for
    // (covered by the unit suite) cannot be read here. What the panel shows must still be
    // the name Chrome reports, whatever it is.
    await expect(panel.getByText('File saved')).toBeVisible({ timeout: 20000 });
    await expect(panel.getByText(path.basename(saved.filename))).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Show in folder' })).toBeVisible();

    // The file on disk is a workbook with a header row and all twenty rows.
    const zip = await JSZip.loadAsync(await fs.readFile(saved.filename));
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet.match(/<row /g)).toHaveLength(21);
    expect(sheet).toContain('Item 01 - Alpha Pro Headset');
    expect(sheet).toContain('Item 20');

    // From the first click to the saved file, the panel asked the network for nothing.
    expect(panelRequests).toEqual([]);
    await target.close();
    await panel.close();
  });

  test('a second download of the same list keeps the first file', async () => {
    const { target, panel } = await open(`${FIXTURES}/twenty-cards.html`);
    await panel.getByRole('button', { name: 'My data' }).click();
    await panel.getByRole('button', { name: /^Open / }).first().click();
    await expect(panel.getByRole('button', { name: 'Download for Excel' })).toBeVisible({ timeout: 15000 });

    const before = await panel.evaluate(async () => (await chrome.downloads.search({})).map((item) => item.id));
    const earlier = await panel.evaluate(async () => (await chrome.downloads.search({})).map((item) => item.filename));
    await panel.getByRole('button', { name: 'Download for Excel' }).click();
    const saved = await waitForCompletedDownload(panel, before);

    expect(earlier).not.toContain(saved.filename);
    for (const file of earlier) {
      await expect(fs.stat(file).then((stat) => stat.size)).resolves.toBeGreaterThan(0);
    }
    await target.close();
    await panel.close();
  });

  test('offers more pages when the page has a Next link, and collects every page', async () => {
    const { target, panel } = await open(`${FIXTURES}/next-page-pagination.html`);

    await panel.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i }).click();
    await expect(panel.getByRole('heading', { name: 'We found 3 items on this page' })).toBeVisible({ timeout: 20000 });
    await panel.getByRole('button', { name: 'Yes, this is my list' }).click();

    const question = panel.getByRole('group', { name: 'This list continues on more pages. Get them too?' });
    await expect(question.getByRole('radio', { name: 'Yes, get more pages' })).toBeChecked();
    await expect(question.getByRole('spinbutton', { name: 'Stop after this many pages:' })).toHaveValue('5');

    await panel.getByRole('button', { name: 'Start collecting' }).click();
    // Three rows on each of the two pages; the second page's Next is switched off.
    await expect(panel.getByRole('heading', { name: 'Done. 6 rows collected' })).toBeVisible({ timeout: 45000 });

    const jobs = await readTable<StoredJob>(panel, 'jobs');
    const job = jobs[jobs.length - 1];
    expect(job).toMatchObject({ status: 'COMPLETED', totalExtracted: 6, pagesVisited: 2 });
    expect(job.schema.pagination).toMatchObject({ type: 'next_button', maxPages: 5 });
    const titles = (await readTable<Record<string, unknown>>(panel, 'records'))
      .filter((row) => row.datasetId === job.datasetId)
      .map((row) => row.Title);
    expect(titles).toEqual(expect.arrayContaining(['Monitor Stand Pro', 'Anti-Fatigue Standing Mat']));
    await target.close();
    await panel.close();
  });

  test('My data lists what was collected, and deletes only after asking in the panel', async () => {
    const { target, panel } = await open(`${FIXTURES}/twenty-cards.html`);
    // A browser confirm() box would be answered "no" by Playwright, and is never used.
    let browserDialogs = 0;
    panel.on('dialog', (dialog) => {
      browserDialogs += 1;
      void dialog.dismiss();
    });

    await panel.getByRole('button', { name: 'My data' }).click();
    await expect(panel.getByRole('heading', { name: 'My data' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Recipes' })).toHaveCount(0);
    const saved = panel.getByRole('button', { name: /^Delete / });
    const count = await saved.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await saved.first().click();
    const dialog = panel.getByRole('dialog', { name: 'Delete this saved list?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(panel.getByRole('button', { name: /^Delete / })).toHaveCount(count);

    await saved.first().click();
    await panel.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(panel.getByRole('button', { name: /^Delete / })).toHaveCount(count - 1);
    expect(await readTable(panel, 'datasets')).toHaveLength(count - 1);
    expect(browserDialogs).toBe(0);
    await target.close();
    await panel.close();
  });

  test('a browser page is called a page that cannot be read, not a site that needs a click', async () => {
    const target = await context.newPage();
    await target.goto('chrome://version/');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront();

    await expect(panel.getByText("Can't read this page")).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText(/Switch to a tab with a website/)).toBeVisible();
    await expect(panel.getByText('Access needed')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Find Data on This Page|Get the list on this page/i })).toBeDisabled();
    await target.close();
    await panel.close();
  });

  test('Help links to the privacy policy and to the licences that ship in the package', async () => {
    const { target, panel } = await open(`${FIXTURES}/twenty-cards.html`);
    await panel.getByRole('button', { name: 'Help' }).click();
    await expect(panel.getByRole('link', { name: /Privacy policy/ })).toHaveAttribute('href', /PRIVACY\.md$/);
    await expect(panel.getByText(/^PageHarvest \d+\.\d+\.\d+$/)).toBeVisible();

    // The licence file is inside the extension, so it opens with no network.
    const notices = await panel.evaluate(async () => {
      const response = await fetch(chrome.runtime.getURL('THIRD_PARTY_NOTICES.txt'));
      return { ok: response.ok, text: await response.text() };
    });
    expect(notices.ok).toBe(true);
    expect(notices.text).toContain('PageHarvest: third-party notices');
    expect(notices.text).toContain('Apache License');
    await target.close();
    await panel.close();
  });
});
