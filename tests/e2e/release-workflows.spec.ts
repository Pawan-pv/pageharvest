import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { expect, test } from './release-test';
import { choosePagination, setLimits, markTourSeen, waitForCompletedDownload } from './helpers/panel';

const fixtureBaseUrl = 'http://127.0.0.1:3456';
const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3');

type DownloadSnapshot = {
  id: number;
  state: string;
  filename: string;
  error?: string;
};

type ContentMessage = {
  id: string;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
};

async function clearLocalDatabase(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const request = indexedDB.open('PageHarvestDB');
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('Could not open PageHarvestDB.'));
      request.onsuccess = () => resolve();
    });

    const database = request.result;
    const storeNames = Array.from(database.objectStoreNames);
    if (storeNames.length === 0) {
      database.close();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeNames, 'readwrite');
      storeNames.forEach((storeName) => transaction.objectStore(storeName).clear());
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear PageHarvestDB.'));
    });
    database.close();
  });
}

async function sendToActiveTab(page: Page, message: ContentMessage): Promise<unknown> {
  return page.evaluate(async (request) => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (typeof tabId !== 'number') {
      throw new Error('The active fixture tab was not available to the extension context.');
    }
    return chrome.tabs.sendMessage(tabId, request);
  }, message);
}

async function queryDownloads(page: Page): Promise<DownloadSnapshot[]> {
  return page.evaluate(async () => {
    const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 20 });
    return items.map((item) => ({
      id: item.id,
      state: item.state,
      filename: item.filename,
      error: item.error,
    }));
  });
}

const waitForDownload = (page: Page, previousIds: Set<number>): Promise<DownloadSnapshot> =>
  waitForCompletedDownload(page, previousIds);

function message(type: string, payload: Record<string, unknown>): ContentMessage {
  return {
    id: `release_${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: Date.now(),
    payload,
  };
}

async function readRecords(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => {
    const request = indexedDB.open('PageHarvestDB');
    return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('Could not read PageHarvestDB.'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('records', 'readonly');
        const getAllRequest = transaction.objectStore('records').getAll();
        getAllRequest.onsuccess = () => {
          database.close();
          resolve(getAllRequest.result as Array<Record<string, unknown>>);
        };
        getAllRequest.onerror = () => reject(getAllRequest.error ?? new Error('Could not read records.'));
      };
    });
  });
}

async function getExtensionId(context: BrowserContext): Promise<{ id: string; worker: Worker }> {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  const id = worker.url().split('/')[2];
  // The first-run tour has its own spec; here it would cover the panel.
  await markTourSeen(worker);
  if (!id) throw new Error(`Could not determine the unpacked extension ID from ${worker.url()}.`);
  return { id, worker };
}

test.describe('PageHarvest release workflows', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let extensionId: string;
  let worker: Worker;
  let profileDirectory: string;
  let downloadDirectory: string;

  test.beforeAll(async () => {
    profileDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-release-profile-'));
    downloadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-release-downloads-'));
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: false,
      downloadsPath: downloadDirectory,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    ({ id: extensionId, worker } = await getExtensionId(context));
    expect(worker.url()).toContain(`chrome-extension://${extensionId}`);
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profileDirectory, { recursive: true, force: true });
    await fs.rm(downloadDirectory, { recursive: true, force: true });
  });

  test('A/F/G: runs a twenty-record extraction, persists it, and exports CSV plus JSON', async ({ releaseDiagnostics: _releaseDiagnostics }, testInfo) => {
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await clearLocalDatabase(sidePanelPage);
    const targetPage = await context.newPage();
    await targetPage.goto(`${fixtureBaseUrl}/twenty-cards.html`);
    await targetPage.waitForLoadState('domcontentloaded');
    await targetPage.bringToFront();

    await expect(sidePanelPage.getByText('127.0.0.1')).toBeVisible();
    await expect(sidePanelPage.getByRole('button', { name: 'Find data automatically', exact: true })).toBeEnabled({ timeout: 10000 });
    await sidePanelPage.getByRole('button', { name: 'Find data automatically', exact: true }).click();
    await expect(sidePanelPage.getByText('20 similar items found').first()).toBeVisible();
    await sidePanelPage.getByRole('button', { name: 'Use this list', exact: true }).click();
    await expect(sidePanelPage.getByText('Choose your columns')).toBeVisible({ timeout: 10000 });

    const startButton = sidePanelPage.getByRole('button', { name: /Start extraction/ });
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(sidePanelPage.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(sidePanelPage.getByText('20 records')).toBeVisible();

    const records = await readRecords(sidePanelPage);
    expect(records).toHaveLength(20);
    expect(records.some((record) => Object.values(record).some((value) => value === 'Item 01 - Alpha Pro Headset'))).toBe(true);

    await sidePanelPage.getByRole('button', { name: 'Datasets' }).click();
    await expect(sidePanelPage.getByText('Saved Extractions')).toBeVisible();
    await expect(sidePanelPage.getByText('20 rows')).toBeVisible();
    await sidePanelPage.reload();
    await sidePanelPage.getByRole('button', { name: 'Datasets' }).click();
    await expect(sidePanelPage.getByText('20 rows')).toBeVisible();
    await sidePanelPage.getByText(/20 Product Listing - PageHarvest Fixture/).last().click();
    await expect(sidePanelPage.getByRole('button', { name: 'Export', exact: true })).toBeVisible();

    const beforeCsv = new Set((await queryDownloads(sidePanelPage)).map((item) => item.id));
    await sidePanelPage.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(sidePanelPage.getByRole('dialog', { name: 'Export data' })).toBeVisible();
    await sidePanelPage.getByRole('button', { name: 'Download File' }).click();
    const csvDownload = await waitForDownload(sidePanelPage, beforeCsv);
    const csvContent = await fs.readFile(csvDownload.filename, 'utf8');
    await testInfo.attach('release-export.csv', { body: csvContent, contentType: 'text/csv' });
    expect(csvContent).toContain('Title');
    expect(csvContent).toContain('Item 01 - Alpha Pro Headset');

    const beforeJson = new Set((await queryDownloads(sidePanelPage)).map((item) => item.id));
    await sidePanelPage.getByRole('button', { name: 'Export', exact: true }).click();
    await sidePanelPage.getByRole('radio', { name: 'JSON', exact: true }).click();
    await sidePanelPage.getByRole('button', { name: 'Download File' }).click();
    const jsonDownload = await waitForDownload(sidePanelPage, beforeJson);
    const jsonContent = await fs.readFile(jsonDownload.filename, 'utf8');
    await testInfo.attach('release-export.json', { body: jsonContent, contentType: 'application/json' });
    const parsedJson: unknown = JSON.parse(jsonContent);
    expect(Array.isArray(parsedJson)).toBe(true);
    expect((parsedJson as Array<unknown>)).toHaveLength(20);

    await targetPage.close();
    await sidePanelPage.close();
  });

  test('B: selects a live card through the visual picker and leaves no overlay after cancellation', async () => {
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const targetPage = await context.newPage();
    await targetPage.goto(`${fixtureBaseUrl}/simple-grid.html`);
    await targetPage.waitForLoadState('domcontentloaded');
    await targetPage.bringToFront();

    await sidePanelPage.getByRole('button', { name: 'Pick items myself', exact: true }).click();
    await expect(sidePanelPage.getByText('Visual Element Picker Active')).toBeVisible();
    await targetPage.locator('.product-card').first().hover();
    await expect(targetPage.locator('#pageharvest-picker-overlay-host')).toBeAttached();
    await targetPage.locator('.product-card').first().click();
    await expect(sidePanelPage.getByRole('heading', { name: 'Is this the data you want?' })).toBeVisible();
    await expect(sidePanelPage.getByText('3 similar items found').first()).toBeVisible();

    await targetPage.keyboard.press('Escape');
    await expect(targetPage.locator('#pageharvest-picker-overlay-host')).toHaveCount(0);
    await targetPage.close();
    await sidePanelPage.close();
  });

  test('C/H: detects different live DOM structures and returns a typed error for an invalid selector', async () => {
    const fixtureNames = [
      'article-listings.html',
      'business-directory.html',
      'job-listings.html',
      'nested-cards.html',
    ];
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    for (const fixtureName of fixtureNames) {
      const targetPage = await context.newPage();
      await targetPage.goto(`${fixtureBaseUrl}/${fixtureName}`);
      await targetPage.waitForLoadState('domcontentloaded');
      await targetPage.bringToFront();
      const response = await sendToActiveTab(sidePanelPage, message('DETECT_REPEATED_ELEMENTS', {}));
      expect(response).toMatchObject({
        type: 'REPEATED_ELEMENTS_DETECTED',
        payload: { matchCount: expect.any(Number) },
      });
      const responsePayload = (response as { payload: { matchCount: number } }).payload;
      expect(responsePayload.matchCount).toBeGreaterThan(0);
      await targetPage.close();
    }

    const targetPage = await context.newPage();
    await targetPage.goto(`${fixtureBaseUrl}/empty-page.html`);
    await targetPage.waitForLoadState('domcontentloaded');
    await targetPage.bringToFront();
    const errorResponse = await sendToActiveTab(sidePanelPage, message('DETECT_REPEATED_ELEMENTS', {
      targetSelector: '.selector-that-does-not-exist',
    }));
    expect(errorResponse).toMatchObject({ type: 'EXTRACTION_ERROR' });
    await targetPage.close();
    await sidePanelPage.close();
  });

  test('E: harvests dynamically appended records with the infinite-scroll runner', async () => {
    // Its own waits add up to more than the default 30s (the run alone may take 45s on a busy machine).
    test.setTimeout(90000);
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const targetPage = await context.newPage();
    await targetPage.goto(`${fixtureBaseUrl}/infinite-scroll.html`);
    await targetPage.waitForLoadState('domcontentloaded');
    await targetPage.bringToFront();

    await expect(sidePanelPage.getByRole('button', { name: 'Find data automatically', exact: true })).toBeEnabled({ timeout: 10000 });
    await sidePanelPage.getByRole('button', { name: 'Find data automatically', exact: true }).click();
    await sidePanelPage.getByRole('button', { name: 'Use this list', exact: true }).click();
    await expect(sidePanelPage.getByText('Choose your columns')).toBeVisible({ timeout: 10000 });
    await choosePagination(sidePanelPage, 'infinite_scroll');
    await setLimits(sidePanelPage, { maxScrolls: 8 });
    await setLimits(sidePanelPage, { scrollDelayMs: 400 });
    await sidePanelPage.getByRole('button', { name: /Start extraction/ }).click();
    await expect(sidePanelPage.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 45000 });

    const records = await readRecords(sidePanelPage);
    const titles = records.flatMap((record) =>
      Object.values(record).filter((value) => /^Article #\d+/.test(String(value)))
    );
    expect(new Set(titles).size).toBe(15);
    expect(titles).toHaveLength(15);

    await targetPage.close();
    await sidePanelPage.close();
  });
});
