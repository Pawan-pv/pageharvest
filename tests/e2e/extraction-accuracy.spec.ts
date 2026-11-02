import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { expect, test } from './release-test';

/**
 * Extraction accuracy through the real unpacked extension: real content script, real
 * service worker, real IndexedDB, real downloads. Assertions read what was actually saved
 * or written to disk, not what the panel says.
 */
const FIXTURES = 'http://127.0.0.1:3456';
const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3');

type Row = Record<string, unknown>;
interface StoredJob {
  id: string;
  status: string;
  datasetId: string;
  duplicatesSkipped: number;
  stopReason?: string;
}

let context: BrowserContext;
let extensionId: string;
let profile: string;
let downloads: string;

test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-accuracy-profile-'));
  downloads = await fs.mkdtemp(path.join(os.tmpdir(), 'pageharvest-accuracy-downloads-'));
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    downloadsPath: downloads,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  extensionId = worker.url().split('/')[2];
});

test.afterAll(async () => {
  await context?.close();
  await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(downloads, { recursive: true, force: true }).catch(() => undefined);
});

test.beforeEach(async () => {
  for (const page of context.pages()) {
    if (page.url().startsWith('http') || page.url().includes('sidepanel.html')) await page.close();
  }
  const panel = await openPanel();
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('PageHarvestDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = Array.from(db.objectStoreNames);
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
  await panel.close();
});

async function openPanel(): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

async function open(fixture: string): Promise<{ panel: Page; target: Page }> {
  const panel = await openPanel();
  const target = await context.newPage();
  await target.goto(`${FIXTURES}/${fixture}`);
  await target.waitForLoadState('load');
  await target.bringToFront();
  return { panel, target };
}

function readTable<T>(panel: Page, table: string): Promise<T[]> {
  return panel.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const request = indexedDB.open('PageHarvestDB');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction(name).objectStore(name).getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(all.result as T[]);
          };
        };
      }),
    table
  );
}

async function finishedRows(panel: Page, status = 'COMPLETED'): Promise<{ job: StoredJob; rows: Row[] }> {
  let job: StoredJob | undefined;
  await expect
    .poll(
      async () => {
        job = (await readTable<StoredJob>(panel, 'jobs')).find((item) => item.status === status);
        return job !== undefined;
      },
      { timeout: 25000, intervals: [100, 200, 300] }
    )
    .toBe(true);
  const rows = (await readTable<Row>(panel, 'records'))
    .filter((row) => row.datasetId === (job as StoredJob).datasetId)
    .sort((a, b) => Number(a._order) - Number(b._order));
  return { job: job as StoredJob, rows };
}

const detect = async (panel: Page, tool = 'Auto-Detect Lists') => {
  await expect(panel.getByRole('button', { name: tool })).toBeEnabled({ timeout: 10000 });
  await panel.getByRole('button', { name: tool }).click();
  await expect(panel.getByText('Repeating Elements Found')).toBeVisible({ timeout: 10000 });
};
const chooseFields = async (panel: Page) => {
  await panel.getByRole('button', { name: 'Next: Choose Fields' }).click();
  await expect(panel.getByText('Columns to Extract')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeEnabled({ timeout: 10000 });
};
const start = (panel: Page) => panel.getByRole('button', { name: /Start Extraction/ }).click();

async function extractWithDefaults(fixture: string) {
  const { panel, target } = await open(fixture);
  await detect(panel);
  await chooseFields(panel);
  await start(panel);
  return { panel, target, ...(await finishedRows(panel)) };
}

async function downloadFile(panel: Page, setup: () => Promise<void>): Promise<string> {
  await panel.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(panel.getByText('Export Extracted Data')).toBeVisible();
  await setup();
  const before = await panel.evaluate(async () => (await chrome.downloads.search({})).map((item) => item.id));
  await panel.getByRole('button', { name: 'Download File' }).click();
  let filename = '';
  await expect
    .poll(async () => {
      const items = await panel.evaluate(async () =>
        (await chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 })).map((item) => ({
          id: item.id,
          state: item.state,
          filename: item.filename,
        }))
      );
      filename = items.find((item) => !before.includes(item.id) && item.state === 'complete')?.filename ?? '';
      return filename.length > 0;
    })
    .toBe(true);
  return fs.readFile(filename, 'utf8');
}

test.describe('numbers', () => {
  test('prices, ranges and ambiguous values are stored correctly, with their original text', async () => {
    const { panel, rows } = await extractWithDefaults('accuracy-prices.html');
    const byTitle = Object.fromEntries(rows.map((row) => [row.Title, row]));
    const note = (title: string) => JSON.parse(String(byTitle[title]._valueNotes)).Price;

    expect(rows).toHaveLength(7);
    expect(byTitle['European amount'].Price).toBe(1234.56);
    expect(note('European amount')).toMatchObject({ raw: '€1.234,56', currency: 'EUR', status: 'ok' });
    expect(byTitle['Spaced amount'].Price).toBe(1234.56);
    expect(byTitle['US amount'].Price).toBe(1299);
    expect(byTitle.Refund.Price).toBe(-25.5);

    expect(byTitle['Salary range'].Price).toBe('$150,000 - $185,000 / yr');
    expect(note('Salary range')).toMatchObject({ status: 'range', min: 150000, max: 185000 });

    expect(byTitle['Ambiguous amount'].Price).toBe('€1.234');
    expect(note('Ambiguous amount')).toMatchObject({ status: 'ambiguous', candidates: [1.234, 1234] });
    expect(byTitle['Bundle offer'].Price).toBe('2 for $10');

    await expect(panel.getByText(/2 values could not be read as one/)).toBeVisible();
  });

  test('the export can include how each number was read', async () => {
    const { panel } = await extractWithDefaults('accuracy-prices.html');

    const csv = await downloadFile(panel, async () => {
      await panel.getByLabel('Include original text and currency for numbers').check();
    });
    const lines = csv.replace(/^﻿/, '').split('\r\n');

    expect(lines[0]).toContain('Price (original),Price (status),Price (currency),Price (min),Price (max)');
    expect(lines.find((line) => line.startsWith('European amount'))).toContain('1234.56,"€1.234,56",ok,EUR');
    expect(lines.find((line) => line.startsWith('Salary range'))).toContain('range,$,150000,185000');
  });
});

test.describe('the picker', () => {
  test('the count shown is the count extracted, with the menu and recommendations left out', async () => {
    const { panel, target } = await open('accuracy-picker.html');

    await panel.getByRole('button', { name: 'Select Elements' }).click();
    await expect(panel.getByText('Visual Element Picker Active')).toBeVisible();
    await target.locator('main li').first().hover();
    await target.locator('main li').first().click();

    await expect(panel.getByText('6 items detected')).toBeVisible();
    await chooseFields(panel);
    await expect(panel.getByText('6 items on page')).toBeVisible();
    await start(panel);

    const { rows } = await finishedRows(panel);
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.Title)).toEqual(Array.from({ length: 6 }, (_, i) => `Result ${i}`));
  });
});

test.describe('field discovery', () => {
  test('offers columns the first record lacks, with evidence, and leaves a rare badge unselected', async () => {
    const { panel } = await open('accuracy-first-row.html');
    await detect(panel);
    await chooseFields(panel);

    await expect(panel.getByRole('checkbox', { name: 'Price' })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: 'Link' })).toBeChecked();
    await expect(panel.getByRole('checkbox', { name: 'Category' })).not.toBeChecked();
    await expect(panel.getByText(/Found in 7 of 8 sampled items/).first()).toBeVisible();

    await start(panel);
    const { rows } = await finishedRows(panel);

    expect(rows.map((row) => row.Title)[0]).toBe('First has no price');
    expect(rows.map((row) => row.Price)).toEqual([null, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
    expect(rows[0]).not.toHaveProperty('Category');
    expect(rows[0]._missingFields).toContain('Price');
  });

  test('Add Column adds a real column', async () => {
    const { panel } = await open('accuracy-regex.html');
    await detect(panel);
    await chooseFields(panel);

    await panel.getByRole('button', { name: 'Add Column' }).first().click();
    await panel.getByLabel(/Column Name/).fill('Reference');
    await panel.getByLabel(/Relative CSS Selector/).fill('.sku');
    await panel.getByRole('button', { name: 'Add Column' }).last().click();
    await start(panel);

    const { rows } = await finishedRows(panel);
    expect(rows.map((row) => row.Reference)[1]).toBe('Reference SKU-101 in stock');
  });

  test('a regex field extracts only the captured part', async () => {
    const { panel } = await open('accuracy-regex.html');
    await detect(panel);
    await chooseFields(panel);

    await panel.getByRole('button', { name: 'Add Column' }).first().click();
    await panel.getByLabel(/Column Name/).fill('Code');
    await panel.getByLabel(/Relative CSS Selector/).fill('.sku');
    await panel.getByLabel('Extractor Type').selectOption('regex');
    await panel.getByLabel(/Regex Pattern/).fill('SKU-(\\d+)');
    await panel.getByLabel(/Capture Group/).fill('1');
    await panel.getByRole('button', { name: 'Add Column' }).last().click();
    await start(panel);

    const { rows } = await finishedRows(panel);
    expect(rows.map((row) => row.Code)).toEqual(['100', '101', '102', '103']);
  });
});

test.describe('Extract Tables', () => {
  test('headers become columns, and only data rows become records', async () => {
    const { panel } = await open('accuracy-tables.html');
    await detect(panel, 'Extract Tables');

    await expect(panel.getByText('4 items detected')).toBeVisible();
    await chooseFields(panel);
    for (const name of ['Team', 'City', 'Score', 'Score 2']) {
      await expect(panel.getByRole('checkbox', { name, exact: true })).toBeChecked();
    }
    await start(panel);

    const { rows } = await finishedRows(panel);
    const read = (row: Row) => [row.Team, row.City, row.Score, row['Score 2']];
    expect(rows.map(read)).toEqual([
      ['Ants', 'Oslo', '1', '2'],
      ['Bees', 'Oslo', '3', '4'],
      ['Cats', 'Rome', null, '6'],
      ['Dogs of Lyon', null, '7', '8'],
    ]);
  });

  test('a page with several tables offers a choice, and a table with no headers still works', async () => {
    const { panel } = await open('accuracy-tables.html');
    await detect(panel, 'Extract Tables');

    await panel.getByRole('radio').nth(1).check();
    await expect(panel.getByText('2 items detected')).toBeVisible();
    await chooseFields(panel);
    await start(panel);

    const { rows } = await finishedRows(panel);
    expect(rows.map((row) => [row['Column 1'], row['Column 2']])).toEqual([
      ['alpha', 'one'],
      ['beta', 'two'],
    ]);
  });

  test('a page with no table says so', async () => {
    const { panel } = await open('accuracy-blog.html');
    await expect(panel.getByRole('button', { name: 'Extract Tables' })).toBeEnabled({ timeout: 10000 });
    await panel.getByRole('button', { name: 'Extract Tables' }).click();

    await expect(panel.getByText('No data table was found on this page.')).toBeVisible();
  });
});

test.describe('Extract Links', () => {
  test('reads links in the content once each, with absolute URLs, and leaves out navigation', async () => {
    const { panel } = await open('accuracy-links.html');
    await detect(panel, 'Extract Links');
    await chooseFields(panel);
    await start(panel);

    const { rows, job } = await finishedRows(panel);
    const urls = rows.map((row) => row.URL);

    expect(urls).toEqual([
      ...Array.from({ length: 6 }, (_, i) => `${FIXTURES}/articles/${i}.html`),
      'https://other.example/ref',
    ]);
    expect(rows[0].Text).toBe('Article 0');
    expect(job.duplicatesSkipped).toBe(6);
  });

  test('navigation links can still be chosen, deliberately', async () => {
    const { panel } = await open('accuracy-links.html');
    await detect(panel, 'Extract Links');

    await panel.getByRole('radio', { name: /Links in the footer/ }).check();
    await chooseFields(panel);
    await start(panel);

    const { rows } = await finishedRows(panel);
    expect(rows).toHaveLength(12);
    expect(String(rows[0].URL)).toContain('/footer/');
  });
});

test.describe('choosing a list', () => {
  test('main results come first, and a larger recommendations block can be chosen instead', async () => {
    const { panel } = await open('accuracy-ranked.html');
    await detect(panel);

    await expect(panel.getByText('10 items detected')).toBeVisible();
    const options = panel.getByRole('radio');
    expect(await options.count()).toBeGreaterThan(1);
    expect(await options.count()).toBeLessThanOrEqual(8);
    await expect(options.first()).toBeChecked();
    await expect(panel.getByText(/labelled as recommendations or promotions/).first()).toBeVisible();

    await panel.getByRole('radio', { name: /24 items/ }).check();
    await expect(panel.getByText('24 items detected')).toBeVisible();
    await chooseFields(panel);
    await start(panel);

    const { rows } = await finishedRows(panel);
    expect(rows).toHaveLength(24);
    expect(String(rows[0].Title)).toContain('Rec 0');
  });

  test('a page with no data list says so, and does not proceed on its own', async () => {
    const { panel } = await open('accuracy-blog.html');
    await detect(panel);

    await expect(panel.getByRole('alert')).toContainText('No data list was found');
    await expect(panel.getByRole('button', { name: 'Next: Choose Fields' })).toBeDisabled();
  });
});

test.describe('images', () => {
  test('real image URLs are stored, never placeholders', async () => {
    const { rows } = await extractWithDefaults('accuracy-images.html');

    expect(rows.map((row) => row.Image)).toEqual([
      `${FIXTURES}/images/plain.jpg`,
      `${FIXTURES}/images/lazy.jpg`,
      `${FIXTURES}/images/other.jpg`,
      `${FIXTURES}/images/big.jpg`,
      null,
    ]);
  });

  test('images that load only when scrolled to are read after they load', async () => {
    const { panel } = await open('accuracy-lazy-scroll.html');
    await detect(panel);
    await panel.getByRole('button', { name: 'Next: Choose Fields' }).click();
    await expect(panel.getByText('Columns to Extract')).toBeVisible();
    await panel.getByRole('button', { name: /Infinite Scroll/ }).click();
    await panel.getByLabel('Max Scrolls').fill('12');
    await panel.getByLabel('Scroll Delay (ms)').fill('400');
    await panel.getByRole('button', { name: 'Add Column' }).first().click();
    await panel.getByLabel(/Column Name/).fill('Picture');
    await panel.getByLabel(/Relative CSS Selector/).fill('img');
    await panel.getByLabel('Extractor Type').selectOption('src');
    await panel.getByRole('button', { name: 'Add Column' }).last().click();
    await start(panel);

    const { rows } = await finishedRows(panel);
    const pictures = rows.map((row) => String(row.Picture));

    expect(pictures.some((url) => url.startsWith('data:'))).toBe(false);
    expect(pictures[0]).toBe(`${FIXTURES}/loaded/0.jpg`);
    expect(new Set(rows.map((row) => row.Title)).size).toBe(rows.length);
  });
});

test.describe('pagination', () => {
  test('a Load More button is followed until it runs out', async () => {
    const { panel } = await open('load-more-pagination.html');
    await detect(panel);
    await chooseFields(panel);
    await panel.getByRole('button', { name: /Next Button/ }).click();
    await panel.getByLabel('Max Pages to Crawl').fill('6');
    await panel.getByLabel('Delay Between Pages (ms)').fill('300');
    await start(panel);

    const { rows } = await finishedRows(panel);
    const titles = rows.map((row) => String(row.Title));

    expect(titles).toContain('Feed Product 1');
    expect(titles).toContain('Feed Product 6');
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('pages that change without a reload are followed', async () => {
    const { panel, target } = await open('accuracy-spa.html');
    await detect(panel);
    await chooseFields(panel);
    await panel.getByRole('button', { name: /Next Button/ }).click();
    await panel.getByLabel('Max Pages to Crawl').fill('5');
    await panel.getByLabel('Delay Between Pages (ms)').fill('300');
    await start(panel);

    const { rows } = await finishedRows(panel);

    expect(rows.map((row) => row.Title)).toEqual([
      'Spa One', 'Spa Two', 'Spa Three', 'Spa Four', 'Spa Five', 'Spa Six', 'Spa Seven', 'Spa Eight',
    ]);
    expect(target.url()).toContain('page=3');
  });
});

test.describe('working with results', () => {
  test('NDJSON export writes one JSON record per line', async () => {
    const { panel } = await extractWithDefaults('accuracy-clean.html');

    const text = await downloadFile(panel, async () => {
      await panel.getByRole('button', { name: /NDJSON/i }).click();
    });
    const lines = text.trim().split('\n').map((line) => JSON.parse(line));

    expect(lines).toHaveLength(4);
    expect(lines[2].Title).toBe('Keep Carrot');
  });

  test('Copy puts the table on the clipboard as CSV', async () => {
    const { panel, target } = await extractWithDefaults('accuracy-clean.html');
    await panel.bringToFront();

    await panel.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Copied!' })).toBeVisible();

    // The clipboard belongs to the system, so a web page can read what the panel wrote.
    await context.grantPermissions(['clipboard-read'], { origin: FIXTURES });
    await target.bringToFront();
    const copied = await target.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('Title');
    expect(copied).toContain('Keep Carrot');
  });

  test('search narrows the rows shown without changing what is saved', async () => {
    const { panel, rows } = await extractWithDefaults('accuracy-clean.html');
    await panel.bringToFront();

    await panel.getByPlaceholder('Search across all columns...').fill('Carrot');

    await expect(panel.getByRole('cell', { name: 'Keep Carrot' })).toBeVisible();
    await expect(panel.getByRole('cell', { name: 'Keep Pear' })).toHaveCount(0);
    expect((await readTable<Row>(panel, 'records')).length).toBe(rows.length);
  });

  test('the column filter narrows the rows shown', async () => {
    const { panel } = await extractWithDefaults('accuracy-clean.html');
    await panel.bringToFront();

    await panel.getByRole('button', { name: 'Filters' }).click();
    await panel.getByPlaceholder(/Filter/i).first().fill('Carrot');

    await expect(panel.getByRole('cell', { name: 'Keep Carrot' })).toBeVisible();
    await expect(panel.getByRole('cell', { name: 'Keep Pear' })).toHaveCount(0);
  });

  test('Find & Replace changes saved data', async () => {
    const { panel, job } = await extractWithDefaults('accuracy-clean.html');
    await panel.bringToFront();

    await panel.getByRole('button', { name: 'Find & Replace' }).click();
    await panel.getByPlaceholder('Text to find...').fill('Keep ');
    await panel.getByPlaceholder('Replacement text...').fill('Saved ');
    await panel.getByRole('button', { name: 'Replace All' }).click();

    await expect(panel.getByRole('cell', { name: 'Saved Carrot' })).toBeVisible();
    await expect
      .poll(async () =>
        (await readTable<Row>(panel, 'records'))
          .filter((row) => row.datasetId === job.datasetId)
          .map((row) => row.Title)
      )
      .toContain('Saved Carrot');
  });

  test('Remove Duplicates removes rows from saved data', async () => {
    const { panel, job, rows } = await extractWithDefaults('accuracy-clean.html');
    expect(rows).toHaveLength(4);
    await panel.bringToFront();

    await panel.getByRole('button', { name: 'Remove Duplicates' }).click();
    const confirm = panel.getByRole('button', { name: /^(Remove|Confirm|Yes)/ }).last();
    await confirm.click();

    await expect
      .poll(async () =>
        (await readTable<Row>(panel, 'records')).filter((row) => row.datasetId === job.datasetId).length
      )
      .toBe(3);
  });
});

test.describe('the library', () => {
  const openLibrary = async (panel: Page, section: string) => {
    await panel.getByRole('button', { name: 'Datasets' }).click();
    await panel.getByRole('navigation', { name: 'Library sections' }).getByRole('button', { name: section }).click();
  };

  test('a project can be created, renamed and deleted, and survives a reload', async () => {
    const panel = await openPanel();
    await openLibrary(panel, 'Projects');

    await panel.getByLabel('New Project').fill('Competitor pricing');
    await panel.getByRole('button', { name: 'Create Project' }).click();
    await expect(panel.getByText('Competitor pricing')).toBeVisible();

    await panel.reload();
    await openLibrary(panel, 'Projects');
    await expect(panel.getByText('Competitor pricing')).toBeVisible();

    await panel.getByRole('button', { name: 'Rename project Competitor pricing' }).click();
    await panel.getByLabel('Project Name').fill('Renamed project');
    await panel.getByRole('button', { name: 'Save Project' }).click();
    await expect(panel.getByText('Renamed project')).toBeVisible();

    await panel.getByRole('button', { name: 'Delete project Renamed project' }).click();
    await panel.getByRole('button', { name: /^Delete/ }).last().click();
    await expect(panel.getByText('Renamed project')).toHaveCount(0);
    expect(await readTable<Row>(panel, 'projects')).toHaveLength(0);
  });

  test('a job saves its schema, which can be reused for a new job', async () => {
    const { panel, target } = await open('accuracy-clean.html');
    await detect(panel);
    await chooseFields(panel);
    await start(panel);
    const first = await finishedRows(panel);
    expect(first.rows).toHaveLength(4);

    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await target.bringToFront();
    await openLibrary(panel, 'Schemas');
    const use = panel.getByRole('button', { name: /^Use schema / }).first();
    await expect(use).toBeVisible();
    await use.click();

    await expect(panel.getByText('Columns to Extract')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Start Extraction/ })).toBeEnabled({ timeout: 10000 });
    await start(panel);

    await expect
      .poll(async () => (await readTable<StoredJob>(panel, 'jobs')).filter((job) => job.status === 'COMPLETED').length, {
        timeout: 25000,
      })
      .toBe(2);
    expect(await readTable<Row>(panel, 'records')).toHaveLength(8);
  });
});
