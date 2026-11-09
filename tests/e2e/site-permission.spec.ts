import { chromium, BrowserContext, Page, Worker } from '@playwright/test';
import { test, expect } from './release-test';
import { markTourSeen } from './helpers/panel';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '../../.output/chrome-mv3-test');
const FIXTURE_ORIGIN = 'http://127.0.0.1:3456';
/** The same server under another name: a different origin, which the test build does not grant. */
const UNGRANTED_ORIGIN = 'http://localhost:3456';

interface JobState {
  status: string;
  lastSequence: number;
  rows: number;
  lastCode?: string;
  reason?: string;
}

/**
 * Site permission and on-demand injection (ADR-037), in a real Chrome.
 *
 * Playwright cannot answer Chrome's permission bubble, so the test build
 * (scripts/testing/test-extension.mjs) already holds the fixture site's grant, like a
 * user who allowed it. What these tests prove is everything after the grant: no static
 * content script, injection into each new document, recovery in a new tab, and refusal
 * for a site that is not granted. Manual checks: the prompt itself, its "this site"
 * wording, and revoking a site in chrome://extensions (covered by
 * tests/integration/site-permission.test.ts against the coordinator).
 */
test.describe('Site permission (ADR-037)', () => {
  let context: BrowserContext;
  let serviceWorker: Worker;
  let extensionId: string;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    serviceWorker = sw;
    extensionId = serviceWorker.url().split('/')[2];
    await markTourSeen(serviceWorker);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  const pagination = {
    type: 'none', maxPages: 1, delayMs: 200, scrollCount: 1, scrollDelayMs: 300,
    startPage: 1, pageIncrement: 1, stopCondition: 'no_new_records',
  };

  function recipe(id: string, containerSelector: string, titleSelector: string, overrides: Record<string, unknown> = {}) {
    return {
      id, name: id, urlPattern: `${FIXTURE_ORIGIN}/*`, containerSelector,
      fields: [{ id: 'title', name: 'Title', selector: titleSelector, extractor: 'text', required: false, transform: 'trim' }],
      pagination: { ...pagination, ...overrides },
      version: 1, createdAt: Date.now(), updatedAt: Date.now(),
    };
  }

  async function open(url: string): Promise<{ target: Page; panel: Page }> {
    const target = await context.newPage();
    await target.goto(url);
    await target.waitForLoadState('load');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront();
    return { target, panel };
  }

  async function startJob(panel: Page, recipeValue: Record<string, unknown>, sourceUrl: string) {
    return panel.evaluate(async ({ recipeValue: value, url }) => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (typeof tabId !== 'number') throw new Error('Fixture tab not available');
      return (await chrome.runtime.sendMessage({
        id: `e2e_site_${Date.now()}`, type: 'START_JOB', timestamp: Date.now(),
        payload: { recipe: value, tabId, sourceUrl: url },
      })) as { ok: boolean; error?: string; identity?: { jobId: string; datasetId: string } };
    }, { recipeValue, url: sourceUrl });
  }

  async function readJob(panel: Page, jobId: string): Promise<JobState> {
    return panel.evaluate(async (id) => {
      const open = indexedDB.open('PageHarvestDB');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const read = <T,>(store: string, run: (s: IDBObjectStore) => IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          const request = run(db.transaction(store).objectStore(store));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      type StoredJob = {
        status: string;
        datasetId: string;
        lastSequence: number;
        interruptedReason?: string;
        errors?: Array<{ code?: string; message?: string }>;
      };
      const job = await read<StoredJob | undefined>('jobs', (s) => s.get(id));
      const rows = job ? await read<number>('records', (s) => s.index('datasetId').count(job.datasetId)) : 0;
      db.close();
      return {
        status: job?.status ?? '',
        lastSequence: job?.lastSequence ?? 0,
        rows,
        lastCode: job?.errors?.at(-1)?.code,
        reason: job?.interruptedReason ?? job?.errors?.at(-1)?.message,
      };
    }, jobId);
  }

  async function waitForStatus(panel: Page, jobId: string, statuses: string[], timeout = 25000): Promise<JobState> {
    const pattern = new RegExp(`^(${statuses.join('|')})$`);
    await expect.poll(async () => (await readJob(panel, jobId)).status, { timeout }).toMatch(pattern);
    return readJob(panel, jobId);
  }

  async function run(panel: Page, recipeValue: Record<string, unknown>, sourceUrl: string): Promise<JobState> {
    const started = await startJob(panel, recipeValue, sourceUrl);
    expect(started.ok, started.error).toBe(true);
    return waitForStatus(panel, started.identity!.jobId, ['COMPLETED', 'FAILED', 'CANCELLED', 'RECOVERABLE']);
  }

  test('installs with no static content script and holds only the granted site', async () => {
    const { target, panel } = await open(`${FIXTURE_ORIGIN}/simple-grid.html`);
    const state = await panel.evaluate(async ({ granted, other }) => ({
      contentScripts: chrome.runtime.getManifest().content_scripts ?? [],
      granted: await chrome.permissions.contains({ origins: [`${granted}/*`] }),
      other: await chrome.permissions.contains({ origins: [`${other}/*`] }),
      allSites: await chrome.permissions.contains({ origins: ['https://*/*'] }),
    }), { granted: FIXTURE_ORIGIN, other: UNGRANTED_ORIGIN });
    expect(state).toEqual({ contentScripts: [], granted: true, other: false, allSites: false });
    await target.close(); await panel.close();
  });

  test('a single-page job injects the content script on demand and completes', async () => {
    const { target, panel } = await open(`${FIXTURE_ORIGIN}/simple-grid.html`);
    const state = await run(panel, recipe('e2e_site_single', '.product-card', '.product-title'), `${FIXTURE_ORIGIN}/simple-grid.html`);
    expect(state.status, state.reason).toBe('COMPLETED');
    expect(state.rows).toBe(3);
    await target.close(); await panel.close();
  });

  test('a Next-button job injects into the next document and completes', async () => {
    const { target, panel } = await open(`${FIXTURE_ORIGIN}/next-page-pagination.html`);
    const state = await run(
      panel,
      recipe('e2e_site_next', '.result-item', '.title', { type: 'next_button', nextButtonSelector: '#next-page', maxPages: 5 }),
      `${FIXTURE_ORIGIN}/next-page-pagination.html`
    );
    expect(state.status, state.reason).toBe('COMPLETED');
    expect(target.url()).toContain('next-page-p2.html');
    expect(state.rows).toBe(6);
    await target.close(); await panel.close();
  });

  test('a URL-template job injects into each page it opens and completes', async () => {
    const { target, panel } = await open(`${FIXTURE_ORIGIN}/url-page-1.html`);
    const state = await run(
      panel,
      recipe('e2e_site_url', '.product-card', '.product-title', {
        type: 'url_template', urlTemplate: `${FIXTURE_ORIGIN}/url-page-{page}.html`, maxPages: 3,
      }),
      `${FIXTURE_ORIGIN}/url-page-1.html`
    );
    expect(state.status, state.reason).toBe('COMPLETED');
    expect(state.rows).toBe(2);
    await target.close(); await panel.close();
  });

  test('an interrupted job resumes in a new tab, where the content script is injected again', async () => {
    const { target, panel } = await open(`${FIXTURE_ORIGIN}/url-page-1.html`);
    const started = await startJob(
      panel,
      recipe('e2e_site_recover', '.product-card', '.product-title', {
        type: 'url_template', urlTemplate: `${FIXTURE_ORIGIN}/url-page-{page}.html`, maxPages: 3, delayMs: 4000,
      }),
      `${FIXTURE_ORIGIN}/url-page-1.html`
    );
    expect(started.ok, started.error).toBe(true);
    const jobId = started.identity!.jobId;
    await expect.poll(async () => (await readJob(panel, jobId)).lastSequence, { timeout: 15000 }).toBeGreaterThanOrEqual(1);

    await target.close();
    const interrupted = await waitForStatus(panel, jobId, ['RECOVERABLE']);
    expect(interrupted.rows).toBe(1);

    const recovered = await panel.evaluate(async (id) =>
      (await chrome.runtime.sendMessage({
        id: `e2e_recover_${Date.now()}`, type: 'RECOVER_JOB', timestamp: Date.now(), payload: { jobId: id },
      })) as { ok: boolean; error?: string },
      jobId
    );
    expect(recovered.ok, recovered.error).toBe(true);
    const done = await waitForStatus(panel, jobId, ['COMPLETED', 'FAILED', 'RECOVERABLE'], 30000);
    expect(done.status, done.reason).toBe('COMPLETED');
    expect(done.rows).toBe(2);
    await panel.close();
  });

  test('a site that is not granted is refused with the site-access message', async () => {
    const { target, panel } = await open(`${FIXTURE_ORIGIN}/simple-grid.html`);
    const result = await startJob(panel, recipe('e2e_site_refused', '.product-card', '.product-title'), `${UNGRANTED_ORIGIN}/simple-grid.html`);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('PageHarvest needs access to this site to continue. Allow access?');
    await target.close(); await panel.close();
  });

  test('injecting twice into one page leaves one content script, and the job still runs once', async () => {
    const { target, panel } = await open(`${FIXTURE_ORIGIN}/simple-grid.html`);
    const flag = await panel.evaluate(async () => {
      const tabId = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id as number;
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/content.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/content.js'] });
      // Runs in the extension's isolated world, the same one the content script uses.
      const [probe] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => (window as unknown as { __PAGEHARVEST_INJECTED__?: boolean }).__PAGEHARVEST_INJECTED__ === true,
      });
      return probe?.result;
    });
    expect(flag).toBe(true);
    const state = await run(panel, recipe('e2e_site_double', '.product-card', '.product-title'), `${FIXTURE_ORIGIN}/simple-grid.html`);
    expect(state.status, state.reason).toBe('COMPLETED');
    expect(state.rows).toBe(3);
    await target.close(); await panel.close();
  });
});
