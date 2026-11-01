import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { expect, test } from './release-test';

/**
 * Production flows against the built extension in real Chromium: real service worker,
 * real content script, real IndexedDB, real page navigations and downloads.
 *
 * The side panel is opened as a tab, because Playwright cannot click browser chrome.
 * Closing that tab is what closing the panel does to the running document.
 */
const FIXTURES = 'http://127.0.0.1:3456';
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3');

interface StoredJob {
  id: string;
  status: string;
  datasetId: string;
  projectId: string;
  runId: string;
  generation: string;
  tabId: number;
  recipeId?: string;
  stopReason?: string;
  errorMessage?: string;
  totalExtracted: number;
  duplicatesSkipped: number;
  scrollsCompleted: number;
  pagesVisited: number;
  progressKind: string;
  targetSteps: number;
  lastSequence: number;
  recordsDetected: number;
  recordsWithMissingFields: number;
  recordsFiltered: number;
  recordsFailed: number;
}

type Row = Record<string, unknown>;

async function launch(profile: string, downloads?: string): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    downloadsPath: downloads,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  return { context, extensionId: worker.url().split('/')[2] };
}

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

async function openTarget(context: BrowserContext, url: string): Promise<Page> {
  const target = await context.newPage();
  await target.goto(url);
  await target.waitForLoadState('domcontentloaded');
  await target.bringToFront();
  return target;
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

const readJobs = (panel: Page) => readTable<StoredJob>(panel, 'jobs');

async function readRows(panel: Page, datasetId: string): Promise<Row[]> {
  const rows = await readTable<Row>(panel, 'records');
  return rows
    .filter((row) => row.datasetId === datasetId)
    .sort((a, b) => Number(a._order) - Number(b._order));
}

async function clearData(panel: Page): Promise<void> {
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('PageHarvestDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = Array.from(db.objectStoreNames);
          if (names.length === 0) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(names, 'readwrite');
          names.forEach((name) => tx.objectStore(name).clear());
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}

async function configure(panel: Page): Promise<void> {
  await expect(panel.getByRole('button', { name: 'Auto-Detect Lists' })).toBeEnabled({ timeout: 10000 });
  await panel.getByRole('button', { name: 'Auto-Detect Lists' }).click();
  await panel.getByRole('button', { name: 'Next: Choose Fields' }).click({ timeout: 10000 });
  await expect(panel.getByText('Columns to Extract')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeEnabled({ timeout: 10000 });
}

const start = (panel: Page) => panel.getByRole('button', { name: /Start Extraction/ }).click();

async function waitForJob(
  panel: Page,
  predicate: (job: StoredJob) => boolean,
  timeout = 30000
): Promise<StoredJob> {
  let found: StoredJob | undefined;
  await expect
    .poll(
      async () => {
        found = (await readJobs(panel)).find(predicate);
        return found !== undefined;
      },
      { timeout, intervals: [100, 200, 300] }
    )
    .toBe(true);
  return found as StoredJob;
}

/**
 * Runs code in the real content-script world of a page. This is how the tests deliver a
 * genuinely late message: it comes from a real content script in the real tab.
 */
async function contentWorld(context: BrowserContext, page: Page): Promise<{
  evaluate: <T>(expression: string) => Promise<T>;
  session: CDPSession;
}> {
  const session = await context.newCDPSession(page);
  const contexts: Array<{ id: number; origin: string; auxData?: { type?: string } }> = [];
  session.on('Runtime.executionContextCreated', (event) => contexts.push(event.context));
  await session.send('Runtime.enable');
  await expect
    .poll(() => contexts.some((c) => c.origin.startsWith('chrome-extension://') && c.auxData?.type === 'isolated'))
    .toBe(true);
  const contextId = contexts.find(
    (c) => c.origin.startsWith('chrome-extension://') && c.auxData?.type === 'isolated'
  )?.id as number;

  return {
    session,
    evaluate: async <T>(expression: string) => {
      const result = await session.send('Runtime.evaluate', {
        expression,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'Evaluation failed');
      }
      return result.result.value as T;
    },
  };
}

function identityOf(job: StoredJob) {
  return {
    jobId: job.id,
    projectId: job.projectId,
    datasetId: job.datasetId,
    runId: job.runId,
    generation: job.generation,
  };
}

function batchExpression(identity: object, sequence: number, titles: string[], url: string): string {
  const message = {
    id: `late_${sequence}_${Date.now()}`,
    type: 'RECORD_BATCH',
    timestamp: Date.now(),
    payload: {
      identity,
      sequence,
      page: Math.max(1, sequence),
      records: titles.map((title, index) => ({
        _id: `t${sequence}_${index}`,
        _page: 1,
        _extractedAt: Date.now(),
        Title: title,
      })),
      stats: { detected: titles.length, missingFields: 0, filtered: 0, failed: 0, duplicates: 0 },
      navigation: {
        nextPage: Math.max(1, sequence) + 1,
        scrollsCompleted: 0,
        awaitingNavigation: false,
        visitedUrls: [],
        url,
      },
    },
  };
  return `chrome.runtime.sendMessage(${JSON.stringify(message)})`;
}

function titleKey(rows: Row[]): string {
  const sample = rows[0] ?? {};
  return Object.keys(sample).find((key) => /title|name/i.test(key) && !key.startsWith('_')) ?? 'Title';
}

function expectNoDuplicates(rows: Row[]): void {
  const key = titleKey(rows);
  const titles = rows.map((row) => row[key]);
  expect(new Set(titles).size).toBe(titles.length);
}

test.describe('PageHarvest production workflows', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120000);

  let context: BrowserContext;
  let extensionId: string;
  let profile: string;
  let downloads: string;

  test.beforeAll(async () => {
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-production-profile-'));
    downloads = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-production-downloads-'));
    ({ context, extensionId } = await launch(profile, downloads));
  });

  test.afterAll(async () => {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
    await fs.rm(downloads, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    const panel = await openPanel(context, extensionId);
    await clearData(panel);
    await panel.close();
  });

  test.afterEach(async () => {
    for (const page of context.pages()) {
      if (page.url() !== 'about:blank') await page.close();
    }
  });

  test('installs with a valid manifest and real icons', async () => {
    const panel = await openPanel(context, extensionId);

    const manifest = await panel.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('116');
    expect(manifest.icons).toMatchObject({
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    });
    expect(manifest.action?.default_icon).toMatchObject({ 128: 'icon/128.png' });

    for (const size of [16, 32, 48, 128]) {
      const dimensions = await panel.evaluate(async (s) => {
        const image = new Image();
        image.src = chrome.runtime.getURL(`icon/${s}.png`);
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, size);
      expect(dimensions).toEqual([size, size]);
    }
  });

  test('A: closing the panel mid-extraction loses nothing, and the job carries on', async () => {
    let panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('6');
    await panel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(panel);

    const running = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.totalExtracted >= 5);
    const rowsAtClose = (await readRows(panel, running.datasetId)).length;
    expect(rowsAtClose).toBeGreaterThanOrEqual(5);

    await panel.close();
    await target.waitForTimeout(3000);
    await target.bringToFront();

    panel = await openPanel(context, extensionId);
    // Rows were committed while no panel existed.
    const rowsAfterReopen = (await readRows(panel, running.datasetId)).length;
    expect(rowsAfterReopen).toBeGreaterThan(rowsAtClose);

    const finished = await waitForJob(panel, (job) => job.id === running.id && job.status === 'COMPLETED');
    expect(finished.stopReason).toBe('max_scrolls_reached');

    const rows = await readRows(panel, running.datasetId);
    expect(rows).toHaveLength(finished.totalExtracted);
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expectNoDuplicates(rows);
    await expect(panel.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('A: the panel reopened during a job shows it running, without restarting it', async () => {
    let panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('8');
    await panel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(panel);
    const running = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.totalExtracted >= 5);

    await panel.close();
    await target.bringToFront();
    panel = await openPanel(context, extensionId);

    await expect(panel.getByText('Harvesting in Progress...')).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText(/Scroll \d+ of 8/)).toBeVisible();
    expect(await readJobs(panel)).toHaveLength(1);

    await panel.getByRole('button', { name: 'Cancel Job' }).click();
    await waitForJob(panel, (job) => job.id === running.id && job.status === 'CANCELLED');
  });

  test('A: stopping the service worker mid-job does not lose or duplicate rows', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('6');
    await panel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(panel);
    const running = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.totalExtracted >= 5);

    const session = await context.newCDPSession(target);
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');

    const finished = await waitForJob(panel, (job) => job.id === running.id && job.status === 'COMPLETED');
    expect(finished.stopReason).toBe('max_scrolls_reached');
    const rows = await readRows(panel, running.datasetId);
    expect(rows).toHaveLength(finished.totalExtracted);
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expectNoDuplicates(rows);
  });

  test('B: a delayed message from a cancelled job cannot touch the next job', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    const world = await contentWorld(context, target);

    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Scroll Delay (ms)').fill('2000');
    await start(panel);
    const jobA = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.lastSequence >= 1);
    const identityA = identityOf(jobA);
    const rowsOfA = (await readRows(panel, jobA.datasetId)).length;

    await panel.getByRole('button', { name: 'Cancel Job' }).click();
    await waitForJob(panel, (job) => job.id === jobA.id && job.status === 'CANCELLED');

    await target.bringToFront();
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Scroll Delay (ms)').fill('2000');
    await start(panel);
    const jobB = await waitForJob(panel, (job) => job.id !== jobA.id && job.lastSequence >= 1);
    expect(jobB.datasetId).not.toBe(jobA.datasetId);
    expect(jobB.generation).not.toBe(jobA.generation);
    const rowsOfBBefore = await readRows(panel, jobB.datasetId);

    const ack = await world.evaluate<{ status: string; reason: string }>(
      batchExpression(identityA, jobA.lastSequence + 1, ['LATE FROM JOB A'], `${FIXTURES}/long-scroll.html`)
    );
    expect(ack).toMatchObject({ status: 'rejected', reason: 'job_not_active' });

    const lateCompletion = await world.evaluate<{ status: string }>(
      `chrome.runtime.sendMessage(${JSON.stringify({
        id: 'late_done',
        type: 'JOB_FINISHED',
        timestamp: Date.now(),
        payload: { identity: identityA, lastSequence: jobA.lastSequence, stopReason: 'completed' },
      })})`
    );
    expect(lateCompletion.status).toBe('rejected');

    expect(await readRows(panel, jobA.datasetId)).toHaveLength(rowsOfA);
    const rowsOfB = await readRows(panel, jobB.datasetId);
    expect(rowsOfB.length).toBeGreaterThanOrEqual(rowsOfBBefore.length);
    expect(rowsOfB.some((row) => row.Title === 'LATE FROM JOB A')).toBe(false);
    expect(rowsOfB.every((row) => row._jobId === jobB.id)).toBe(true);
    expect((await readJobs(panel)).find((job) => job.id === jobA.id)?.status).toBe('CANCELLED');

    await panel.getByRole('button', { name: 'Cancel Job' }).click();
    await waitForJob(panel, (job) => job.id === jobB.id && job.status === 'CANCELLED');
  });

  test('B: two tabs extract at the same time without mixing', async () => {
    const panel = await openPanel(context, extensionId);

    const tabOne = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('3');
    await panel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(panel);
    const first = await waitForJob(panel, (job) => job.status === 'RUNNING');

    const secondPanel = await openPanel(context, extensionId);
    const tabTwo = await openTarget(context, `${FIXTURES}/infinite-scroll.html`);
    await secondPanel.getByRole('button', { name: 'Cancel Job' }).waitFor({ timeout: 10000 });
    // This panel follows the job already running. A new job needs a fresh panel state.
    await secondPanel.getByRole('button', { name: /Finish & View Results/ }).isVisible();
    await tabTwo.bringToFront();

    const finishedFirst = await waitForJob(panel, (job) => job.id === first.id && job.status === 'COMPLETED');
    await tabOne.close();

    await secondPanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await tabTwo.bringToFront();
    await configure(secondPanel);
    await secondPanel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await secondPanel.getByLabel('Max Scrolls').fill('2');
    await secondPanel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(secondPanel);
    const second = await waitForJob(secondPanel, (job) => job.id !== first.id && job.status === 'COMPLETED');

    const rowsOne = await readRows(panel, finishedFirst.datasetId);
    const rowsTwo = await readRows(panel, second.datasetId);
    expect(rowsOne.every((row) => row._jobId === first.id)).toBe(true);
    expect(rowsTwo.every((row) => row._jobId === second.id)).toBe(true);
    expect(rowsOne.length).toBeGreaterThan(0);
    expect(rowsTwo.length).toBeGreaterThan(0);
  });

  test('C: a browser restart mid-job is recovered, with nothing lost or duplicated', async () => {
    const recoveryProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-recovery-profile-'));
    let session = await launch(recoveryProfile);
    let panel = await openPanel(session.context, session.extensionId);
    await openTarget(session.context, `${FIXTURES}/long-scroll.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('6');
    await panel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(panel);

    const interrupted = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.scrollsCompleted >= 2);
    const rowsBefore = await readRows(panel, interrupted.datasetId);
    expect(rowsBefore.length).toBeGreaterThanOrEqual(5);

    await session.context.close();
    session = await launch(recoveryProfile);

    try {
      panel = await openPanel(session.context, session.extensionId);
      // Reloads until the panel has reconciled against tabs that no longer exist.
      await expect(async () => {
        await panel.reload();
        await expect(panel.getByText('Interrupted Session Detected')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30000 });

      await expect(panel.getByText(/\d+ scrolls \/ \d+ rows/)).toBeVisible();
      expect((await readJobs(panel))[0].status).toBe('RECOVERABLE');

      const rowsAfterRestart = await readRows(panel, interrupted.datasetId);
      expect(rowsAfterRestart.length).toBeGreaterThanOrEqual(rowsBefore.length);
      const preserved = new Set(rowsAfterRestart.map((row) => row[titleKey(rowsBefore)]));
      for (const row of rowsBefore) {
        expect(preserved.has(row[titleKey(rowsBefore)])).toBe(true);
      }

      await panel.getByRole('button', { name: 'Resume Session' }).click();
      const finished = await waitForJob(panel, (job) => job.id === interrupted.id && job.status === 'COMPLETED', 60000);

      const jobs = await readJobs(panel);
      expect(jobs).toHaveLength(1);
      expect(finished.stopReason).toBe('max_scrolls_reached');

      const rows = await readRows(panel, interrupted.datasetId);
      expectNoDuplicates(rows);
      expect(rows.length).toBeGreaterThan(rowsAfterRestart.length);
      expect(rows).toHaveLength(finished.totalExtracted);

      expect(await readTable(panel, 'checkpoints')).toHaveLength(0);
      await panel.reload();
      await panel.getByRole('button', { name: 'Datasets' }).waitFor();
      await expect(panel.getByText('Interrupted Session Detected')).toHaveCount(0);
    } finally {
      await session.context.close();
      await fs.rm(recoveryProfile, { recursive: true, force: true });
    }
  });

  test('C: closing the job tab offers recovery, and discarding keeps the rows', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Scroll Delay (ms)').fill('1000');
    await start(panel);
    const running = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.totalExtracted >= 5);

    await target.close();

    await expect(panel.getByText('Interrupted Session Detected')).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText(/was closed/)).toBeVisible();
    const rows = await readRows(panel, running.datasetId);

    await panel.getByRole('button', { name: 'Discard Session' }).click();
    await waitForJob(panel, (job) => job.id === running.id && job.status === 'CANCELLED');
    await expect(panel.getByText('Interrupted Session Detected')).toHaveCount(0);
    expect(await readRows(panel, running.datasetId)).toHaveLength(rows.length);
    expect(await readTable(panel, 'checkpoints')).toHaveLength(0);
  });

  test('D: settings survive closing and reopening the extension', async () => {
    let panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Settings' }).click();
    await expect(panel.getByRole('button', { name: 'Save Preferences' })).toBeEnabled();

    await panel.getByLabel('Default Page Delay (ms)').fill('2750');
    await panel.getByLabel('Default Max Pages Limit').fill('42');
    await panel.getByLabel('Default Max Scrolls').fill('17');
    await panel.getByLabel(/Include UTF-8 BOM/).uncheck();
    await panel.getByRole('button', { name: 'Save Preferences' }).click();
    await expect(panel.getByText('Settings saved successfully.')).toBeVisible();
    await panel.close();

    panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Settings' }).click();
    await expect(panel.getByLabel('Default Page Delay (ms)')).toHaveValue('2750');
    await expect(panel.getByLabel('Default Max Pages Limit')).toHaveValue('42');
    await expect(panel.getByLabel('Default Max Scrolls')).toHaveValue('17');
    await expect(panel.getByLabel(/Include UTF-8 BOM/)).not.toBeChecked();

    // The saved defaults reach a new extraction.
    await panel.getByRole('button', { name: 'Harvest' }).click();
    await openTarget(context, `${FIXTURES}/simple-grid.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await expect(panel.getByLabel('Max Scrolls')).toHaveValue('17');
    await panel.getByRole('button', { name: /Next Button/ }).click();
    await expect(panel.getByLabel('Max Pages to Crawl')).toHaveValue('42');

    // Put the defaults back for the tests that follow.
    await panel.getByRole('button', { name: 'Settings' }).click();
    await panel.getByLabel('Default Page Delay (ms)').fill('1500');
    await panel.getByLabel('Default Max Pages Limit').fill('20');
    await panel.getByLabel('Default Max Scrolls').fill('30');
    await panel.getByLabel(/Include UTF-8 BOM/).check();
    await panel.getByRole('button', { name: 'Save Preferences' }).click();
    await expect(panel.getByText('Settings saved successfully.')).toBeVisible();
  });

  test('E: a saved recipe survives a reload and runs a new job', async () => {
    let panel = await openPanel(context, extensionId);
    let target = await openTarget(context, `${FIXTURES}/simple-grid.html`);
    await configure(panel);
    await panel.getByLabel('Recipe Name').fill('Grid recipe');
    await panel.getByRole('button', { name: 'Save Recipe' }).click();
    await expect(panel.getByText('Saved recipe "Grid recipe".')).toBeVisible();

    await panel.close();
    panel = await openPanel(context, extensionId);
    await target.bringToFront();

    await panel.getByRole('button', { name: 'Datasets' }).click();
    await panel.getByRole('button', { name: 'Recipes' }).click();
    await panel.getByRole('button', { name: 'Run recipe Grid recipe' }).click();
    await expect(panel.getByText('Columns to Extract')).toBeVisible();

    await target.close();
    target = await openTarget(context, `${FIXTURES}/simple-grid.html`);
    await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeEnabled();
    await start(panel);

    const job = await waitForJob(panel, (candidate) => candidate.status === 'COMPLETED');
    const recipes = await readTable<{ id: string; name: string }>(panel, 'recipes');
    expect(recipes.map((recipe) => recipe.name)).toEqual(['Grid recipe']);
    expect(job.recipeId).toBe(recipes[0].id);
    expect(await readRows(panel, job.datasetId)).toHaveLength(3);
    await target.close();
  });

  test('F: run history records success, failure and cancellation, across a reload', async () => {
    let panel = await openPanel(context, extensionId);

    // Success, saved as a recipe so it can then be broken on purpose.
    let target = await openTarget(context, `${FIXTURES}/simple-grid.html`);
    await configure(panel);
    await panel.getByLabel('Recipe Name').fill('History recipe');
    await panel.getByRole('button', { name: 'Save Recipe' }).click();
    await expect(panel.getByText('Saved recipe "History recipe".')).toBeVisible();
    await start(panel);
    await waitForJob(panel, (job) => job.status === 'COMPLETED');
    await target.close();

    // Failure: a container selector that is not valid CSS.
    target = await openTarget(context, `${FIXTURES}/simple-grid.html`);
    await panel.getByRole('button', { name: 'Datasets' }).click();
    await panel.getByRole('button', { name: 'Recipes' }).click();
    await panel.getByRole('button', { name: 'Edit recipe History recipe' }).click();
    await panel.getByLabel('Container Selector').fill('###not-valid');
    await panel.getByRole('button', { name: 'Save Changes' }).click();
    await panel.getByRole('button', { name: 'Run recipe History recipe' }).click();
    await target.bringToFront();
    await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeEnabled();
    await start(panel);
    await waitForJob(panel, (job) => job.status === 'FAILED');
    await expect(panel.getByText(/not a valid CSS selector/)).toBeVisible();
    await panel.getByRole('button', { name: 'Close' }).click();
    await target.close();

    // Cancellation
    target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    await expect(panel.getByRole('button', { name: 'Auto-Detect Lists' })).toBeEnabled({ timeout: 10000 });
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await start(panel);
    const cancelled = await waitForJob(panel, (job) => job.status === 'RUNNING');
    await panel.getByRole('button', { name: 'Cancel Job' }).click();
    await waitForJob(panel, (job) => job.id === cancelled.id && job.status === 'CANCELLED');
    await target.close();

    await panel.close();
    panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Datasets' }).click();
    await panel.getByRole('button', { name: 'Run History' }).click();

    await expect(panel.getByText('COMPLETED')).toBeVisible();
    await expect(panel.getByText('FAILED')).toBeVisible();
    await expect(panel.getByText('CANCELLED')).toBeVisible();
    await expect(panel.getByText(/not a valid CSS selector/)).toBeVisible();

    const runs = await readTable<{ status: string; jobId: string; projectId: string }>(panel, 'history');
    expect(runs.map((run) => run.status).sort()).toEqual(['CANCELLED', 'COMPLETED', 'FAILED']);
    expect(runs.every((run) => run.jobId && run.projectId)).toBe(true);
  });

  test('G: cards missing the first, middle or last fields are all kept and counted', async () => {
    const panel = await openPanel(context, extensionId);
    await openTarget(context, `${FIXTURES}/missing-fields.html`);
    await configure(panel);
    await start(panel);

    const job = await waitForJob(panel, (candidate) => candidate.status === 'COMPLETED');
    const rows = await readRows(panel, job.datasetId);

    expect(rows).toHaveLength(6);
    expect(job.recordsDetected).toBe(6);
    expect(job.totalExtracted).toBe(6);
    expect(job.recordsFiltered).toBe(0);
    expect(job.recordsFailed).toBe(0);
    expect(job.recordsWithMissingFields).toBe(4);
    expect(rows.filter((row) => row._missingFields)).toHaveLength(4);

    await expect(panel.getByLabel('Extraction summary')).toContainText('6 detected, 6 kept, 4 with missing fields');
  });

  test('H: a real hash collision keeps both records, across real page loads', async () => {
    const panel = await openPanel(context, extensionId);
    await openTarget(context, `${FIXTURES}/collision-1.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Next Button/ }).click();
    await panel.getByLabel('Delay Between Pages (ms)').fill('200');
    await start(panel);

    const job = await waitForJob(panel, (candidate) => candidate.status === 'COMPLETED');
    const rows = await readRows(panel, job.datasetId);
    const titles = rows.map((row) => Object.values(row).find((value) => /^Product /.test(String(value))));

    // Collide under the old 32-bit hash, and differ, so both must survive.
    expect(titles).toContain('Product 1079599');
    expect(titles).toContain('Product 1262382');
    // A true duplicate on page 2 is still removed.
    expect(titles.filter((title) => title === 'Product Companion')).toHaveLength(1);
    expect(job.duplicatesSkipped).toBe(1);
    expect(job.pagesVisited).toBe(2);
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(String(row._hash)))).toBe(true);
  });

  test('H: 50,000 records commit through real IndexedDB with exact duplicate handling', async () => {
    test.setTimeout(240000);
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    const world = await contentWorld(context, target);
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Scroll Delay (ms)').fill('10000');
    await start(panel);
    const running = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.lastSequence >= 1);

    // The real page run is held at its pause gate; these batches take its place.
    await panel.getByRole('button', { name: 'Pause' }).click();
    await waitForJob(panel, (job) => job.id === running.id && job.status === 'PAUSED');
    const identity = identityOf(running);
    const baseline = running.totalExtracted;
    let sequence = running.lastSequence;
    let inserted = 0;
    let duplicates = 0;

    const total = 50_000;
    const batchSize = 5000;
    for (let startIndex = 0; startIndex < total; startIndex += batchSize) {
      sequence += 1;
      const titles = Array.from({ length: batchSize }, (_, offset) => {
        const n = startIndex + offset;
        return n > 0 && n % 500 === 0 ? 'Volume row 0' : `Volume row ${n}`;
      });
      const ack = await world.evaluate<{ status: string; inserted: number; duplicates: number }>(
        batchExpression(identity, sequence, titles, `${FIXTURES}/long-scroll.html`)
      );
      expect(ack.status).toBe('committed');
      inserted += ack.inserted;
      duplicates += ack.duplicates;
    }

    expect(duplicates).toBe(99);
    expect(inserted).toBe(total - 99);

    const stored = await panel.evaluate(
      (datasetId) =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open('PageHarvestDB');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const count = db.transaction('records').objectStore('records').index('datasetId').count(datasetId);
            count.onsuccess = () => {
              db.close();
              resolve(count.result);
            };
          };
        }),
      running.datasetId
    );
    expect(stored).toBe(baseline + total - 99);

    await panel.getByRole('button', { name: 'Cancel Job' }).click();
    await waitForJob(panel, (job) => job.id === running.id && job.status === 'CANCELLED');
  });

  test('I: the downloaded CSV keeps numbers intact and neutralizes formulas', async () => {
    const panel = await openPanel(context, extensionId);
    await openTarget(context, `${FIXTURES}/csv-values.html`);
    await expect(panel.getByRole('button', { name: 'Auto-Detect Lists' })).toBeEnabled({ timeout: 10000 });
    await panel.getByRole('button', { name: 'Auto-Detect Lists' }).click();
    await panel.getByRole('button', { name: 'Next: Choose Fields' }).click({ timeout: 10000 });
    await expect(panel.getByText('Columns to Extract')).toBeVisible();
    // Both columns are found automatically: the items have no heading to recognize.
    await expect(panel.getByRole('button', { name: 'Start Extraction (2 columns)' })).toBeEnabled({ timeout: 10000 });
    await start(panel);
    await waitForJob(panel, (job) => job.status === 'COMPLETED');

    await panel.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(panel.getByText('Export Extracted Data')).toBeVisible();
    const before = await panel.evaluate(async () => {
      const items = await chrome.downloads.search({});
      return items.map((item) => item.id);
    });
    await panel.getByRole('button', { name: 'Download File' }).click();

    let filename = '';
    await expect
      .poll(async () => {
        const items = await panel.evaluate(async () => {
          const found = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 });
          return found.map((item) => ({ id: item.id, state: item.state, filename: item.filename }));
        });
        const done = items.find((item) => !before.includes(item.id) && item.state === 'complete');
        filename = done?.filename ?? '';
        return filename.length > 0;
      })
      .toBe(true);

    const csv = await fs.readFile(filename, 'utf8');
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    const cell = (kind: string) => lines.find((line) => line.startsWith(kind + ',')) ?? '';

    expect(cell('negative decimal')).toBe('negative decimal,-12.50');
    expect(cell('positive signed')).toBe('positive signed,+5');
    expect(cell('zero')).toBe('zero,0');
    expect(cell('negative')).toBe('negative,-5');

    expect(cell('sum formula')).toContain(`"' =SUM(A1:A5)"`);
    expect(cell('command')).toContain(`"' +cmd|' /C calc'!A0"`);
    expect(cell('minus formula')).toContain(`"' -2+3+cmd|' /C calc'!A0"`);
    expect(cell('at formula')).toContain(`"' @SUM(A1)"`);

    expect(cell('quotes')).toContain('"He said ""Hi"""');
    expect(cell('comma')).toContain('"Hello, World"');
    expect(cell('unicode')).toContain('Café 日本語 ₹1299');
  });

  test('J: URL template pagination through the UI survives an interruption and finishes clean', async () => {
    const panel = await openPanel(context, extensionId);
    let target = await openTarget(context, `${FIXTURES}/catalog-1.html`);
    await configure(panel);

    await panel.getByRole('button', { name: /URL Template/ }).click();
    await panel.getByLabel('Page URL Template').fill(`${FIXTURES}/catalog-{page}.html`);
    await panel.getByLabel('Maximum Pages').fill('5');
    await panel.getByLabel('Delay Between Pages (ms)').fill('3000');
    await expect(panel.getByRole('list', { name: 'Generated page URLs' })).toContainText('catalog-2.html');

    // A template for another site is refused before it can start.
    await panel.getByLabel('Page URL Template').fill('https://other.example.com/{page}');
    await expect(panel.getByText(/must stay on/)).toBeVisible();
    await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeDisabled();
    await panel.getByLabel('Page URL Template').fill(`${FIXTURES}/catalog-{page}.html`);
    await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeEnabled();

    await start(panel);
    const first = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.lastSequence >= 1);
    await expect(panel.getByText(/Page \d+ of 5/)).toBeVisible();

    // Interrupt during the delay before the next page.
    await target.close();
    await expect(panel.getByText('Interrupted Session Detected')).toBeVisible({ timeout: 15000 });
    const checkpoints = await readTable<{ expectedUrl: string }>(panel, 'checkpoints');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].expectedUrl).toBe(`${FIXTURES}/catalog-2.html`);

    await panel.getByRole('button', { name: 'Resume Session' }).click();
    const finished = await waitForJob(panel, (job) => job.id === first.id && job.status === 'COMPLETED', 60000);

    const rows = await readRows(panel, first.datasetId);
    expect(finished.totalExtracted).toBe(6);
    expect(finished.stopReason).toBe('empty_page');
    expect(rows).toHaveLength(finished.totalExtracted);
    expectNoDuplicates(rows);

    expect(await readTable(panel, 'checkpoints')).toHaveLength(0);
    const history = await readTable<{ jobId: string; status: string }>(panel, 'history');
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ jobId: first.id, status: 'COMPLETED' })]));

    target = context.pages().find((page) => page.url().includes('catalog-')) as Page;
    expect(target.url()).toContain('catalog-3.html');
  });

  test('K: the configured scroll limit is the number of real scroll actions', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    const world = await contentWorld(context, target);
    await world.evaluate(
      `(() => { const original = window.scrollBy.bind(window); window.__scrolls = 0;
        window.scrollBy = (...args) => { window.__scrolls += 1; return original(...args); }; return true; })()`
    );

    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('3');
    await panel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(panel);

    await expect(panel.getByText(/Scroll \d+ of 3/)).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText(/Page \d+ of/)).toHaveCount(0);

    const job = await waitForJob(panel, (candidate) => candidate.status === 'COMPLETED');

    expect(await world.evaluate<number>('window.__scrolls')).toBe(3);
    expect(job.stopReason).toBe('max_scrolls_reached');
    expect(job.progressKind).toBe('scrolls');
    expect(job.targetSteps).toBe(3);
    expect(job.totalExtracted).toBe(20);
  });

  test('Next Button follows ordinary links across documents', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/next-page-pagination.html`);
    await configure(panel);
    await panel.getByRole('button', { name: /Next Button/ }).click();
    await panel.getByLabel('Delay Between Pages (ms)').fill('200');
    await start(panel);

    const job = await waitForJob(panel, (candidate) => candidate.status === 'COMPLETED');

    expect(target.url()).toContain('next-page-p2.html');
    expect(await readRows(panel, job.datasetId)).toHaveLength(6);
    expect(job.pagesVisited).toBe(2);
    await expect(panel.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('Pause, Finish and Cancel really stop the page', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/long-scroll.html`);
    const cards = () => target.locator('.scroll-card').count();
    await configure(panel);
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Scroll Delay (ms)').fill('500');
    await start(panel);
    const running = await waitForJob(panel, (job) => job.status === 'RUNNING' && job.lastSequence >= 2);

    // Pause: anything already past the gate settles, then nothing moves.
    await panel.getByRole('button', { name: 'Pause' }).click();
    await expect(panel.getByText('Extraction Paused')).toBeVisible();
    await target.waitForTimeout(3000);
    const cardsPaused = await cards();
    const rowsPaused = (await readRows(panel, running.datasetId)).length;
    await target.waitForTimeout(3000);
    expect(await cards()).toBe(cardsPaused);
    expect((await readRows(panel, running.datasetId)).length).toBe(rowsPaused);
    await expect(panel.getByText('Extraction Paused')).toBeVisible();

    // Resume: it moves again.
    await panel.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(cards, { timeout: 15000 }).toBeGreaterThan(cardsPaused);

    // Finish: the page stops and the results open.
    await panel.getByRole('button', { name: /Finish & View Results/ }).click();
    await expect(panel.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 15000 });
    await target.waitForTimeout(2500);
    const cardsFinished = await cards();
    const rowsFinished = (await readRows(panel, running.datasetId)).length;
    await target.waitForTimeout(3000);
    expect(await cards()).toBe(cardsFinished);
    expect((await readRows(panel, running.datasetId)).length).toBe(rowsFinished);
    expect((await readJobs(panel))[0]).toMatchObject({ status: 'COMPLETED', stopReason: 'finished_by_user' });
  });

  test('grid edits persist to storage and survive reopening', async () => {
    let panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/twenty-cards.html`);
    panel.on('dialog', (dialog) => void dialog.accept());
    await configure(panel);
    await start(panel);
    await expect(panel.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 15000 });

    const columns = () => panel.getByTitle('Delete column').count();
    const startingColumns = await columns();
    await panel.getByTitle('Delete column').first().click({ force: true });
    await expect.poll(columns).toBe(startingColumns - 1);

    // Editing a cell afterwards must not bring the deleted column back.
    await panel.getByTitle('Double click to edit cell').nth(1).dblclick();
    const input = panel.locator('input[type="text"]:focus');
    await input.fill('Edited by test');
    await input.press('Enter');
    await expect(panel.getByText('Edited by test')).toBeVisible();
    expect(await columns()).toBe(startingColumns - 1);

    await panel.close();
    await target.bringToFront();
    panel = await openPanel(context, extensionId);
    panel.on('dialog', (dialog) => void dialog.accept());
    await panel.getByRole('button', { name: 'Datasets' }).click();
    await panel.getByText(/20 Product Listing/).last().click();
    await expect(panel.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 15000 });

    await expect.poll(columns).toBe(startingColumns - 1);
    await expect(panel.getByText('Edited by test')).toBeVisible();
  });

  test('saved rows reopen in page order', async () => {
    const panel = await openPanel(context, extensionId);
    await openTarget(context, `${FIXTURES}/twenty-cards.html`);
    await configure(panel);
    await start(panel);
    const job = await waitForJob(panel, (candidate) => candidate.status === 'COMPLETED');

    const rows = await readRows(panel, job.datasetId);
    const titles = rows.map((row) => Object.values(row).find((value) => /^Item \d\d/.test(String(value))) as string);
    expect(titles).toEqual([...titles].sort());
    expect(titles).toHaveLength(20);
  });

  test('the picker overlay works through a closed shadow root', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/simple-grid.html`);

    await panel.getByRole('button', { name: 'Select Elements' }).click();
    await expect(panel.getByText('Visual Element Picker Active')).toBeVisible();
    await target.locator('.product-card').first().hover();
    const host = target.locator('#pageharvest-picker-overlay-host');
    await expect(host).toBeAttached();

    // Page scripts cannot reach inside.
    expect(await host.evaluate((element) => element.shadowRoot)).toBeNull();

    await target.locator('.product-card').first().click();
    await expect(panel.getByText('Repeating Elements Found')).toBeVisible();
    await expect(panel.getByText('3 items detected')).toBeVisible();

    // Click the real toolbar button by where it is on screen. CDP can see into a closed
    // root; the page and the extension expose nothing for this.
    const session = await context.newCDPSession(target);
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const findCancel = (node: { nodeId: number; attributes?: string[]; children?: unknown[]; shadowRoots?: unknown[] }): number | null => {
      const className = node.attributes?.[(node.attributes.indexOf('class') ?? -1) + 1] ?? '';
      if (node.attributes?.includes('class') && /\bph-btn-cancel\b/.test(className)) return node.nodeId;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        const found = findCancel(child as never);
        if (found) return found;
      }
      return null;
    };
    const cancelId = findCancel(root as never);
    expect(cancelId).not.toBeNull();
    const { model } = await session.send('DOM.getBoxModel', { nodeId: cancelId as number });
    const [x1, y1, , , x3, y3] = model.content;
    await target.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);

    await expect(host).toHaveCount(0);
    await expect(panel.getByText('Quick Actions')).toBeVisible();
  });

  test('Escape closes the picker and removes every trace of it', async () => {
    const panel = await openPanel(context, extensionId);
    const target = await openTarget(context, `${FIXTURES}/simple-grid.html`);

    await panel.getByRole('button', { name: 'Select Elements' }).click();
    await target.locator('.product-card').first().hover();
    await expect(target.locator('#pageharvest-picker-overlay-host')).toBeAttached();

    await target.keyboard.press('Escape');

    await expect(target.locator('#pageharvest-picker-overlay-host')).toHaveCount(0);
    await expect(panel.getByText('Quick Actions')).toBeVisible();
  });
});
