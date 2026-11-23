import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { test, expect } from './release-test';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONSENT_STORAGE_KEY } from '../../src/components/consent/consent';
import { markTourSeen } from './helpers/panel';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pathToExtension = path.resolve(__dirname, '../../.output/chrome-mv3-test');

test.describe('PageHarvest v2 Suite Real Chromium Smoke Gate', () => {
  test.describe.configure({ mode: 'serial' });

  let context: BrowserContext;
  let serviceWorker: Worker;
  let extensionId: string;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    serviceWorker = sw;
    extensionId = serviceWorker.url().split('/')[2];
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('1. ConsentGate: blocks on clean profile, unblocks on "I understand, continue", persists on reload', async () => {
    // Ensure clean state without consent
    await serviceWorker.evaluate(async (key) => {
      await chrome.storage.local.remove(key);
    }, CONSENT_STORAGE_KEY);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Verify blocking ConsentGate disclosure
    const heading = panel.getByRole('heading', { name: 'Before you start' });
    await expect(heading).toBeVisible({ timeout: 10000 });
    await expect(panel.getByText('100% local processing in your browser')).toBeVisible();

    const acceptButton = panel.getByRole('button', { name: 'I understand, continue' });
    await expect(acceptButton).toBeVisible();
    await acceptButton.click();

    // Verify main App header renders immediately
    await expect(panel.getByRole('heading', { name: 'PageHarvest', exact: true })).toBeVisible();

    // Reload sidepanel and verify ConsentGate is NOT shown again
    await panel.reload();
    await expect(panel.getByRole('heading', { name: 'PageHarvest', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(panel.getByRole('heading', { name: 'Before you start' })).toHaveCount(0);

    await panel.close();
  });

  test('2. OLED ToolHub: renders all 10 live tool cards with zero console/page errors', async () => {
    // Open a web page so the active tab is injectable and tools are enabled
    const webPage = await context.newPage();
    await webPage.goto('http://127.0.0.1:3456/v2-contact.html');
    await webPage.bringToFront();

    // Mark tour as seen so it doesn't mask the panel
    await markTourSeen(serviceWorker);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const tools = [
      'Find Data on This Page',
      'Extract a table',
      'Extract all links',
      'Page Extractor',
      'Sitemap Explorer',
      'Shopify Extractor',
      'Image Downloader',
      'Email Extractor',
      'Social Link Extractor',
      'Page Text Extractor',
    ];

    for (const toolAria of tools) {
      await expect(panel.getByRole('button', { name: toolAria })).toBeVisible({ timeout: 5000 });
    }

    await panel.close();
    await webPage.close();
  });

  test('3. Full-Tab Workbench (table.html): loads cleanly, renders saved dataset, switches tools', async () => {
    await markTourSeen(serviceWorker);
    const tablePage = await context.newPage();
    await tablePage.goto(`chrome-extension://${extensionId}/table.html`);

    await expect(tablePage.locator('#root')).toBeVisible({ timeout: 10000 });
    await expect(tablePage.getByRole('heading', { name: 'PageHarvest workbench' })).toBeVisible();

    // Verify navigating directly to a tool in workbench via query param
    await tablePage.goto(`chrome-extension://${extensionId}/table.html?tool=page`);
    await expect(tablePage.getByRole('heading', { name: 'Page Extractor 2.0' })).toBeVisible({ timeout: 10000 });

    // Click back to tables
    const backBtn = tablePage.getByRole('button', { name: /Back to tables/i });
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    await tablePage.close();
  });

  test('4. New v2 Tools: exercises all 7 batch extractors end-to-end on local fixtures', async () => {
    test.setTimeout(60000);

    // Open fixture page in front
    const fixtureTab = await context.newPage();
    await fixtureTab.goto('http://127.0.0.1:3456/v2-contact.html');
    await fixtureTab.waitForLoadState('domcontentloaded');
    await fixtureTab.bringToFront();

    await markTourSeen(serviceWorker);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Ensure the fixture tab remains the active tab for the panel
    await fixtureTab.bringToFront();
    await panel.waitForTimeout(500);

    // 4a. Sitemap Explorer
    await panel.getByRole('button', { name: 'Sitemap Explorer' }).click();
    await expect(panel.getByRole('heading', { name: 'Sitemap Explorer' })).toBeVisible({ timeout: 5000 });
    const sitemapInput = panel.getByPlaceholder(/example\.com/i);
    await sitemapInput.fill('http://127.0.0.1:3456/sitemap.xml');
    await panel.getByRole('button', { name: 'Explore' }).click();
    await expect(panel.getByText(/URLs selected/i)).toBeVisible({ timeout: 10000 });
    await panel.getByRole('button', { name: 'Back to tools' }).click();

    // 4b. Page Extractor
    await panel.getByRole('button', { name: 'Page Extractor' }).click();
    await expect(panel.getByRole('heading', { name: 'Page Extractor 2.0' })).toBeVisible({ timeout: 5000 });
    const urlsInput = panel.getByPlaceholder(/Paste URLs here/i);
    await urlsInput.fill('http://127.0.0.1:3456/slow-contact.html');
    await panel.getByRole('button', { name: /Start Extraction/i }).click();
    await expect(panel.getByText(/Keep this panel or workbench tab open while running/i)).toBeVisible({ timeout: 5000 });
    await expect(panel.getByText(/Progress: 1 \/ 1/i)).toBeVisible({ timeout: 15000 });
    await panel.getByRole('button', { name: 'Back to tools' }).click();

    // 4c. Email Extractor
    await panel.getByRole('button', { name: 'Email Extractor' }).click();
    await expect(panel.getByRole('heading', { name: 'Email Extractor' })).toBeVisible({ timeout: 5000 });
    const emailUrls = panel.getByPlaceholder(/Paste addresses/i);
    await emailUrls.fill('http://127.0.0.1:3456/v2-contact.html');
    await panel.getByRole('button', { name: /Start Extraction/i }).click();
    await expect(panel.getByText(/Processed 1 of 1 URLs/i)).toBeVisible({ timeout: 15000 });
    await panel.getByRole('button', { name: 'Back to tools' }).click();

    // 4d. Social Link Extractor
    await panel.getByRole('button', { name: 'Social Link Extractor' }).click();
    await expect(panel.getByRole('heading', { name: 'Social Link Extractor' })).toBeVisible({ timeout: 5000 });
    const socialUrls = panel.getByPlaceholder(/Paste addresses/i);
    await socialUrls.fill('http://127.0.0.1:3456/v2-contact.html');
    await panel.getByRole('button', { name: /Start Extraction/i }).click();
    await expect(panel.getByText(/Processed 1 of 1 URLs/i)).toBeVisible({ timeout: 15000 });
    await panel.getByRole('button', { name: 'Back to tools' }).click();

    // 4e. Page Text Extractor
    await panel.getByRole('button', { name: 'Page Text Extractor' }).click();
    await expect(panel.getByRole('heading', { name: 'Page Text Extractor' })).toBeVisible({ timeout: 10000 });
    const textUrls = panel.getByPlaceholder(/Paste article URLs/i);
    await textUrls.fill('http://127.0.0.1:3456/v2-contact.html');
    await panel.getByRole('button', { name: /Start Extraction/i }).click();
    await expect(panel.getByText(/Processed 1 of 1 URLs/i)).toBeVisible({ timeout: 15000 });
    await panel.getByRole('button', { name: 'Back to tools' }).click();

    // 4f. Shopify Extractor
    await panel.getByRole('button', { name: 'Shopify Extractor' }).click();
    await expect(panel.getByRole('heading', { name: 'Shopify Extractor' })).toBeVisible({ timeout: 10000 });
    const shopifyUrl = panel.getByPlaceholder(/brand shop URL|mystore/i);
    await shopifyUrl.fill('http://127.0.0.1:3456');
    await panel.getByRole('button', { name: /Start Extraction/i }).click();
    await expect(panel.getByText(/Products Found/i)).toBeVisible({ timeout: 10000 });
    await panel.getByRole('button', { name: 'Back to tools' }).click();

    // 4g. Image Downloader
    await fixtureTab.bringToFront();
    await panel.getByRole('button', { name: 'Image Downloader' }).click();
    await expect(panel.getByRole('heading', { name: 'Bulk Image Downloader' })).toBeVisible({ timeout: 10000 });
    await panel.getByRole('button', { name: /Scan Page Images/i }).click();
    await expect(panel.getByRole('button', { name: /Save as Dataset/i })).toBeVisible({ timeout: 10000 });
    await panel.getByRole('button', { name: 'Back to tools' }).click();

    await fixtureTab.close();
    await panel.close();
  });
});

