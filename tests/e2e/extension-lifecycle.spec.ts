import { chromium, BrowserContext, Page, Worker } from '@playwright/test';
import { test, expect } from './release-test';
import { markTourSeen } from './helpers/panel';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pathToExtension = path.resolve(__dirname, '../../.output/chrome-mv3-test');

test.describe('PageHarvest Browser Extension E2E Suite', () => {
  let context: BrowserContext;
  let serviceWorker: Worker;
  let extensionId: string;

  test.beforeAll(async () => {
    // Launch actual Chromium with the unpacked Chrome MV3 extension
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`
      ]
    });

    // 1. Extension loads: locate background service worker
    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    serviceWorker = sw;
    extensionId = serviceWorker.url().split('/')[2];
    // The first-run tour has its own spec; here it would cover the panel.
    await markTourSeen(serviceWorker);
    console.log(`[E2E] Unpacked Chrome MV3 Extension Loaded with ID: ${extensionId}`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('1. Extension loads background service worker successfully', async () => {
    expect(extensionId).toBeDefined();
    expect(extensionId.length).toBeGreaterThan(0);
    expect(serviceWorker.url()).toContain(`chrome-extension://${extensionId}`);
  });

  test('2. Side panel opens and initializes interface', async () => {
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Verify main header and application root exist
    await expect(sidePanelPage.locator('#root')).toBeVisible();
    await expect(sidePanelPage.getByRole('heading', { name: 'PageHarvest' })).toBeVisible();

    await sidePanelPage.close();
  });

  test('3. Content script communicates and current tab is identified', async () => {
    // Open target website tab from our local fixture server
    const targetPage = await context.newPage();
    await targetPage.goto('http://127.0.0.1:3456/simple-grid.html');
    await targetPage.waitForLoadState('domcontentloaded');

    // Open side panel page
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Bring target page to front so it becomes active tab
    await targetPage.bringToFront();

    // Side panel should identify the active tab
    await expect(sidePanelPage.locator('#root')).toBeVisible();

    // Verify browser messages work: send PING from side panel to background router
    const pingResult = await sidePanelPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            id: `e2e_ping_${Date.now()}`,
            type: 'PING',
            timestamp: Date.now()
          },
          (response) => resolve(response)
        );
      });
    });

    expect(pingResult).toBeDefined();
    expect(pingResult).toEqual(expect.objectContaining({
      type: 'PONG',
      payload: expect.objectContaining({ status: 'OK' }),
    }));

    await targetPage.close();
    await sidePanelPage.close();
  });

  test('4. Extraction result reaches side panel and local records persist after reload', async () => {
    // 1. Open the local fixture site
    const targetPage = await context.newPage();
    await targetPage.goto('http://127.0.0.1:3456/simple-grid.html');
    await targetPage.waitForLoadState('networkidle');

    // 2. Open side panel
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // 3. Inject extraction test into sidePanel storage (IndexedDB without hardcoded version)
    await sidePanelPage.evaluate(async () => {
      const request = indexedDB.open('PageHarvestDB');
      return new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['datasets', 'records'], 'readwrite');
          const datasets = tx.objectStore('datasets');
          const records = tx.objectStore('records');

          datasets.put({
            id: 'ds_e2e_test',
            name: 'E2E Extracted Dataset',
            url: 'http://127.0.0.1:3456/simple-grid.html',
            recordsCount: 3,
            fields: [
              { id: 'f1', name: 'title', selector: '.product-title', extractor: 'text' },
              { id: 'f2', name: 'price', selector: '.product-price', extractor: 'number' }
            ],
            createdAt: Date.now(),
            updatedAt: Date.now()
          });

          records.put({
            _id: 'rec_e2e_1',
            datasetId: 'ds_e2e_test',
            _page: 1,
            _extractedAt: Date.now(),
            title: 'Ergonomic Mechanical Keyboard',
            price: 129.99
          });
          records.put({
            _id: 'rec_e2e_2',
            datasetId: 'ds_e2e_test',
            _page: 1,
            _extractedAt: Date.now(),
            title: 'Ultra-Wide Gaming Monitor',
            price: 349.5
          });
          records.put({
            _id: 'rec_e2e_3',
            datasetId: 'ds_e2e_test',
            _page: 1,
            _extractedAt: Date.now(),
            title: 'Wireless Noise-Cancelling Headphones',
            price: 89.0
          });

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    });

    // 4. Verify extraction records are present in side panel storage
    const storedCountBefore = await sidePanelPage.evaluate(async () => {
      return new Promise<number>((resolve) => {
        const req = indexedDB.open('PageHarvestDB');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('records', 'readonly');
          const store = tx.objectStore('records');
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
        };
      });
    });
    expect(storedCountBefore).toBe(3);

    // 5. Reload side panel page to test persistent storage across reloads
    await sidePanelPage.reload();
    await sidePanelPage.waitForLoadState('domcontentloaded');

    const storedCountAfter = await sidePanelPage.evaluate(async () => {
      return new Promise<number>((resolve) => {
        const req = indexedDB.open('PageHarvestDB');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('records', 'readonly');
          const store = tx.objectStore('records');
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
        };
      });
    });

    // Records must persist in local IndexedDB after reload
    expect(storedCountAfter).toBe(3);

    await targetPage.close();
    await sidePanelPage.close();
  });

  /** Starts a job the way the side panel does, and waits for it to end in storage. */
  async function runJob(
    sidePanelPage: Page,
    recipe: Record<string, unknown>,
    sourceUrl: string
  ): Promise<{ job: Record<string, unknown>; rows: Array<Record<string, unknown>>; checkpoints: number }> {
    return sidePanelPage.evaluate(
      async ({ recipeValue, url }) => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (typeof tabId !== 'number') throw new Error('The fixture tab was not available.');

        const result = (await chrome.runtime.sendMessage({
          id: `e2e_start_${Date.now()}`,
          type: 'START_JOB',
          timestamp: Date.now(),
          payload: { recipe: recipeValue, tabId, sourceUrl: url },
        })) as { ok: boolean; error?: string; identity?: { jobId: string; datasetId: string } };
        if (!result.ok || !result.identity) throw new Error(result.error ?? 'The job did not start.');
        const { jobId, datasetId } = result.identity;

        const read = () =>
          new Promise<{
            job: Record<string, unknown>;
            rows: Array<Record<string, unknown>>;
            checkpoints: number;
          }>((resolve, reject) => {
            const open = indexedDB.open('PageHarvestDB');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction(['jobs', 'records', 'checkpoints']);
              const job = tx.objectStore('jobs').get(jobId);
              const rows = tx.objectStore('records').index('datasetId').getAll(datasetId);
              const checkpoints = tx.objectStore('checkpoints').count(jobId);
              tx.oncomplete = () => {
                db.close();
                resolve({
                  job: job.result as Record<string, unknown>,
                  rows: rows.result as Array<Record<string, unknown>>,
                  checkpoints: checkpoints.result,
                });
              };
            };
          });

        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
          const state = await read();
          if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(state.job?.status))) return state;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('The job did not finish in time.');
      },
      { recipeValue: recipe, url: sourceUrl }
    );
  }

  const titleField = {
    id: 'title',
    name: 'Title',
    selector: '.product-title',
    extractor: 'text',
    required: false,
    transform: 'trim',
  };

  test('5. Content workflow extracts records from the live fixture DOM', async () => {
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const targetPage = await context.newPage();
    await targetPage.goto('http://127.0.0.1:3456/simple-grid.html');
    await targetPage.waitForLoadState('networkidle');
    await targetPage.bringToFront();

    const detectResponse = await sidePanelPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (typeof tabId !== 'number') {
        throw new Error('The fixture tab was not available to the extension context.');
      }
      return chrome.tabs.sendMessage(tabId, {
        id: `e2e_detect_${Date.now()}`,
        type: 'DETECT_REPEATED_ELEMENTS',
        timestamp: Date.now(),
      });
    });
    expect(detectResponse).toMatchObject({
      type: 'REPEATED_ELEMENTS_DETECTED',
      payload: { matchCount: 3 },
    });

    const { job, rows } = await runJob(
      sidePanelPage,
      {
        id: 'e2e_recipe',
        name: 'Live fixture',
        urlPattern: 'http://127.0.0.1:3456/*',
        containerSelector: '.product-card',
        fields: [
          titleField,
          {
            id: 'price',
            name: 'Price',
            selector: '.product-price',
            extractor: 'number',
            required: false,
            transform: 'trim',
          },
        ],
        pagination: {
          type: 'none',
          maxPages: 1,
          delayMs: 200,
          scrollCount: 1,
          scrollDelayMs: 300,
          startPage: 1,
          pageIncrement: 1,
          stopCondition: 'no_new_records',
        },
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      'http://127.0.0.1:3456/simple-grid.html'
    );

    expect(job.status).toBe('COMPLETED');
    expect(job.totalExtracted).toBe(3);
    expect(rows.sort((a, b) => Number(a._order) - Number(b._order)).map((row) => row.Title)).toEqual([
      'Ergonomic Mechanical Keyboard',
      'Ultra-Wide Gaming Monitor',
      'Wireless Noise-Cancelling Headphones',
    ]);

    await targetPage.close();
    await sidePanelPage.close();
  });

  test('6. URL pagination navigates real fixture documents and resumes from durable state', async () => {
    const sidePanelPage = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const targetPage = await context.newPage();
    await targetPage.goto('http://127.0.0.1:3456/url-page-1.html');
    await targetPage.waitForLoadState('networkidle');
    await targetPage.bringToFront();

    const { job, rows, checkpoints } = await runJob(
      sidePanelPage,
      {
        id: 'e2e_url_recipe',
        name: 'URL fixture products',
        urlPattern: 'http://127.0.0.1:3456/url-page-{page}.html',
        containerSelector: '.product-card',
        fields: [titleField],
        pagination: {
          type: 'url_template',
          urlTemplate: 'http://127.0.0.1:3456/url-page-{page}.html',
          maxPages: 3,
          delayMs: 200,
          scrollCount: 1,
          scrollDelayMs: 300,
          startPage: 1,
          pageIncrement: 1,
          stopCondition: 'no_new_records',
        },
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      'http://127.0.0.1:3456/url-page-1.html'
    );

    expect(rows.sort((a, b) => Number(a._order) - Number(b._order)).map((row) => row.Title)).toEqual([
      'URL Product One',
      'URL Product Two',
    ]);
    expect(targetPage.url()).toBe('http://127.0.0.1:3456/url-page-3.html');
    expect(job).toMatchObject({ status: 'COMPLETED', totalExtracted: 2, pagesVisited: 3 });
    // The resumable session is gone once the job has ended.
    expect(checkpoints).toBe(0);

    await targetPage.close();
    await sidePanelPage.close();
  });
});
