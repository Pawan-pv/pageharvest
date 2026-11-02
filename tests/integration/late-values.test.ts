import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { BASE_URL, ExtensionHarness, makeBatch, makeRecipe, renderCards } from '../utils/job-harness';

const TAB = 601;
const FIELDS = [
  { id: 't', name: 'Title', selector: '.t', extractor: 'text' as const, required: false, transform: 'trim' as const },
  { id: 'p', name: 'Picture', selector: 'img', extractor: 'src' as const, required: false, transform: 'trim' as const },
];

describe('a value that arrives after a row was first read', () => {
  it('marks the later read as filling in the earlier one', () => {
    document.body.innerHTML = '<div class="c"><h3 class="t">One</h3><img></div>';
    const containers = Array.from(document.querySelectorAll('.c'));
    const memory = new WeakMap<Element, string>();

    const first = extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);
    expect(first.records).toHaveLength(1);
    expect(first.records[0].Picture).toBeNull();
    expect(first.records[0]._supersedes).toBeUndefined();

    document.querySelector('img')?.setAttribute('src', '/real.jpg');
    const second = extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);

    expect(second.records).toHaveLength(1);
    expect(second.records[0].Picture).toContain('/real.jpg');
    expect(second.records[0]._supersedes).toBe(JSON.stringify([['Title', 'One']]));
  });

  it('does not count the same row as detected twice', () => {
    document.body.innerHTML = '<div class="c"><h3 class="t">One</h3><img></div>';
    const containers = Array.from(document.querySelectorAll('.c'));
    const memory = new WeakMap<Element, string>();
    extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);

    document.querySelector('img')?.setAttribute('src', '/real.jpg');
    const second = extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);

    expect(second.totalParsed).toBe(0);
  });

  it('treats a recycled element with different content as a new row', () => {
    document.body.innerHTML = '<div class="c"><h3 class="t">One</h3><img src="/1.jpg"></div>';
    const containers = Array.from(document.querySelectorAll('.c'));
    const memory = new WeakMap<Element, string>();
    extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);

    const title = document.querySelector('.t') as Element;
    title.textContent = 'Two';
    document.querySelector('img')?.setAttribute('src', '/2.jpg');
    const second = extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);

    expect(second.records).toHaveLength(1);
    expect(second.records[0]._supersedes).toBeUndefined();
    expect(second.totalParsed).toBe(1);
  });

  it('treats a value that changed, rather than arrived, as a new row', () => {
    document.body.innerHTML = '<div class="c"><h3 class="t">One</h3><img src="/1.jpg"></div>';
    const containers = Array.from(document.querySelectorAll('.c'));
    const memory = new WeakMap<Element, string>();
    extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);

    document.querySelector('img')?.setAttribute('src', '/changed.jpg');
    const second = extractRecordsFromContainers(containers, FIELDS, 1, new Set(), BASE_URL, memory);

    expect(second.records[0]._supersedes).toBeUndefined();
  });
});

describe('committing a row that fills in an earlier one', () => {
  let harness: ExtensionHarness;

  const row = (fields: Record<string, unknown>) => ({
    _id: `temp_${Math.random()}`,
    _page: 1,
    _extractedAt: 1,
    ...fields,
  });
  const batch = (
    identity: Parameters<typeof makeBatch>[0],
    sequence: number,
    records: Array<Record<string, unknown>>,
    missingFields = 0
  ) =>
    makeBatch(identity, sequence, [], {
      records,
      stats: { detected: records.length, missingFields, filtered: 0, failed: 0, duplicates: 0 },
    });
  const start = async () => {
    renderCards([]);
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    coordinator.extractRecords = () => ({ accepted: true });
    return harness.start(TAB, makeRecipe({ type: 'infinite_scroll' }));
  };
  const supersedes = JSON.stringify([['Title', 'One']]);

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(async () => {
    harness.db.close();
    await harness.db.delete();
  });

  it('updates the stored row, keeping its place, without adding a row', async () => {
    const job = await start();
    await harness.sendFromPage(TAB, batch(job, 1, [
      row({ Title: 'One', Picture: null, _missingFields: 'Picture' }),
      row({ Title: 'Two', Picture: '/2.jpg' }),
    ], 1));

    const ack = await harness.sendFromPage(TAB, batch(job, 2, [
      row({ Title: 'One', Picture: '/1.jpg', _supersedes: supersedes }),
    ]));

    expect(ack).toMatchObject({ status: 'committed', inserted: 0 });
    const rows = await harness.rows(job.datasetId);
    expect(rows.map((item) => [item.Title, item.Picture])).toEqual([
      ['One', '/1.jpg'],
      ['Two', '/2.jpg'],
    ]);
    expect(rows[0]._missingFields).toBeUndefined();
    expect(rows[0]._supersedes).toBeUndefined();
  });

  it('keeps the job counts right', async () => {
    const job = await start();
    await harness.sendFromPage(TAB, batch(job, 1, [
      row({ Title: 'One', Picture: null, _missingFields: 'Picture' }),
    ], 1));

    await harness.sendFromPage(TAB, batch(job, 2, [
      row({ Title: 'One', Picture: '/1.jpg', _supersedes: supersedes }),
    ]));

    expect(await harness.job(job.jobId)).toMatchObject({
      totalExtracted: 1,
      recordsWithMissingFields: 0,
    });
  });

  it('can be delivered twice without changing anything', async () => {
    const job = await start();
    await harness.sendFromPage(TAB, batch(job, 1, [row({ Title: 'One', Picture: null })]));
    const late = batch(job, 2, [row({ Title: 'One', Picture: '/1.jpg', _supersedes: supersedes })]);

    await harness.sendFromPage(TAB, late);
    const again = await harness.sendFromPage(TAB, late);

    expect(again.status).toBe('duplicate');
    expect(await harness.rows(job.datasetId)).toHaveLength(1);
  });

  it('adds the row normally if there is nothing to fill in, so no data is lost', async () => {
    const job = await start();

    await harness.sendFromPage(TAB, batch(job, 1, [
      row({ Title: 'One', Picture: '/1.jpg', _supersedes: supersedes }),
    ]));

    const rows = await harness.rows(job.datasetId);
    expect(rows.map((item) => item.Picture)).toEqual(['/1.jpg']);
    expect(rows[0]._supersedes).toBeUndefined();
  });

  it('never fills in a row from another dataset', async () => {
    const first = await start();
    await harness.sendFromPage(TAB, batch(first, 1, [row({ Title: 'One', Picture: null })]));
    await harness.coordinator.finishJob(first.jobId);

    const second = await start();
    await harness.sendFromPage(TAB, batch(second, 1, [
      row({ Title: 'One', Picture: '/1.jpg', _supersedes: supersedes }),
    ]));

    expect((await harness.rows(first.datasetId))[0].Picture).toBeNull();
    expect((await harness.rows(second.datasetId))[0].Picture).toBe('/1.jpg');
  });
});

describe('duplicates removed in the page are reported', () => {
  it('a recipe that keeps one row per URL says how many it removed', async () => {
    const harness = new ExtensionHarness();
    document.body.innerHTML = `<main>
      <a class="l" href="/a">A</a><a class="l" href="/a">A again</a><a class="l" href="/b">B</a>
    </main>`;
    const page = harness.loadPage(TAB, `${BASE_URL}/list`);
    const job = await harness.start(
      TAB,
      makeRecipe(
        {},
        {
          containerSelector: '.l',
          dedupeFields: ['URL'],
          fields: [
            { id: 'u', name: 'URL', selector: ':scope', extractor: 'href', required: false, transform: 'trim' },
          ],
        }
      )
    );
    await page.coordinator.runSettled();

    const stored = await harness.job(job.jobId);
    expect(await harness.rows(job.datasetId)).toHaveLength(2);
    expect(stored?.duplicatesSkipped).toBe(1);

    harness.db.close();
    await harness.db.delete();
  });
});
