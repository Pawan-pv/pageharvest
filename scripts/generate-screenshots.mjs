/**
 * Generates Chrome Web Store promotional screenshots for PageHarvest.
 *
 *   node scripts/generate-screenshots.mjs
 *
 * Loads the built extension into Playwright Chromium, navigates the side
 * panel to real-looking pages (competitor pricing, product catalogs) and
 * captures 1280x800 screenshots without localhost or test-fixture markers.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'store-assets');
const extensionPath = join(root, '.output/chrome-mv3');

async function main() {
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      `--disable-extensions`,
      `--enable-features=Extensions`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // ── Screenshot 1: Harvest dashboard with a real-looking active tab ──
  // Navigate to a realistic product page so the dashboard shows a real URL
  // instead of a restricted chrome-extension:// page.
  await page.goto('https://example.com/products/laptops', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Open side panel via the extension action (headless can't click toolbar,
  // so we use the sidepanel.html directly as fallback if the action doesn't work).
  const extId = await page.evaluate(async () => {
    return (globalThis).chrome?.runtime?.id;
  }).catch(() => null);

  // Navigate to the side panel page and screenshot
  const sidePanelUrl = extId
    ? `chrome-extension://${extId}/sidepanel.html`
    : 'about:blank';

  if (extId) {
    const sp = await context.newPage();
    await sp.goto(sidePanelUrl, { waitUntil: 'domcontentloaded' });
    await sp.waitForTimeout(2000);
    await sp.screenshot({ path: join(outputDir, 'screenshot-1280x800.png') });
    console.log('Saved screenshot-1280x800.png (dashboard)');
    await sp.close();
  }

  // ── Screenshot 2: Data grid with realistic extracted data ──
  if (extId) {
    // Seed IndexedDB with realistic-looking extraction data
    const sp2 = await context.newPage();
    await sp2.goto(sidePanelUrl, { waitUntil: 'domcontentloaded' });
    await sp2.waitForTimeout(1000);

    await sp2.evaluate(async () => {
      const dbName = 'PageHarvestDB';
      const db = await new Promise((resolve, reject) => {
        const req = globalThis.indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const now = Date.now();
      const tx = db.transaction(['datasets', 'records', 'jobs'], 'readwrite');

      const datasetsStore = tx.objectStore('datasets');
      datasetsStore.put({
        id: 'dataset_competitor_pricing',
        name: 'Competitor Laptop Pricing — Dell.com',
        url: 'https://www.dell.com/en-us/shop/laptops',
        projectId: 'project_dell',
        jobId: 'job_pricing_001',
        recipeId: 'recipe_laptops',
        recordsCount: 120,
        fields: [
          { id: 'f1', name: 'Model', selector: '.title', extractor: 'text' },
          { id: 'f2', name: 'Price', selector: '.price', extractor: 'number' },
          { id: 'f3', name: 'Processor', selector: '.cpu', extractor: 'text' },
          { id: 'f4', name: 'RAM', selector: '.ram', extractor: 'text' },
          { id: 'f5', name: 'Link', selector: 'a', extractor: 'href' },
        ],
        createdAt: now - 3600000,
        updatedAt: now,
      });

      const records = [];
      const models = ['XPS 13', 'XPS 15', 'Inspiron 14', 'Inspiron 16', 'Latitude 5540', 'Precision 5680'];
      for (let i = 0; i < 120; i++) {
        records.push({
          _id: `rec_pricing_${i}`,
          _page: Math.floor(i / 30) + 1,
          _extractedAt: now - 3600000 + i * 100,
          datasetId: 'dataset_competitor_pricing',
          _jobId: 'job_pricing_001',
          _projectId: 'project_dell',
          Model: models[i % models.length] + (i >= 6 ? ` — ${Math.floor(i / 6) + 1}` : ''),
          Price: 799 + Math.floor(Math.random() * 1200),
          Processor: ['Intel Core i5-1335U', 'Intel Core i7-1360P', 'Intel Core i7-13700H', 'AMD Ryzen 7 7730U'][i % 4],
          RAM: ['8 GB', '16 GB', '32 GB'][i % 3],
          Link: `https://www.dell.com/en-us/shop/dell-laptops/xps-${13 + (i % 3)}-${i}`,
        });
      }
      const recordsStore = tx.objectStore('records');
      for (const r of records) recordsStore.put(r);

      await new Promise((resolve) => { tx.oncomplete = resolve; });
      db.close();
    });

    // Reload to show results view
    await sp2.reload({ waitUntil: 'domcontentloaded' });
    await sp2.waitForTimeout(2000);

    // Navigate to results view by clicking "View all" or selecting dataset
    // The dataset should appear in Recent Extractions on the dashboard.
    // Click the first dataset card to view in grid.
    const datasetCard = sp2.getByText('Competitor Laptop Pricing');
    if (await datasetCard.isVisible()) {
      await datasetCard.click();
      await sp2.waitForTimeout(2000);
    }

    await sp2.screenshot({ path: join(outputDir, 'screenshot-data-grid.png') });
    console.log('Saved screenshot-data-grid.png (data grid)');
    await sp2.close();
  }

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
