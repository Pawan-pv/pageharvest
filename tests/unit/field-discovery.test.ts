import { beforeEach, describe, expect, it } from 'vitest';
import { discoverFieldsInCluster, suggestionsToFieldDefinitions } from '@/core/detection/fields';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { createContentWorkflowCoordinator } from '@/content/workflow-coordinator';

const repeat = (count: number, item: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => item(index)).join('');
const items = () => Array.from(document.querySelectorAll('.card'));
const named = (name: string) => discoverFieldsInCluster(items()).find((field) => field.name === name);

function extract() {
  const fields = suggestionsToFieldDefinitions(discoverFieldsInCluster(items()));
  return extractRecordsFromContainers(items(), fields).records;
}

describe('field discovery looks at many records', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('offers a column that the first record does not have', () => {
    document.body.innerHTML = repeat(
      5,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i === 0 ? '' : `<span class="price">$${i}.00</span><img src="/${i}.jpg"><a href="/i/${i}">Open</a>`}</article>`
    );

    const names = discoverFieldsInCluster(items()).map((field) => field.name);

    expect(names).toEqual(expect.arrayContaining(['Title', 'Price', 'Image', 'Link']));
    expect(extract().map((row) => row.Price)).toEqual([null, 1, 2, 3, 4]);
  });

  it('offers a column that only the last record has', () => {
    document.body.innerHTML = repeat(
      6,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i === 5 ? '<span class="price">$9.00</span>' : ''}</article>`
    );

    expect(named('Price')).toBeDefined();
    expect(named('Price')?.coverage).toBe(0.17);
    expect(named('Price')?.suggested).toBe(false);
    expect(extract().map((row) => row.Price)).toEqual([null, null, null, null, null, 9]);
  });

  it('offers a column that only a middle record has, in a long list', () => {
    document.body.innerHTML = repeat(
      41,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i % 10 === 5 ? `<span class="price">$${i}.00</span>` : ''}</article>`
    );

    expect(named('Price')).toBeDefined();
  });

  it('handles first, middle and last records with different missing fields', () => {
    const cards = [
      '<h3>A</h3><span class="price">$1.00</span>',
      '<a href="/b">B link</a><span class="price">$2.00</span>',
      '<h3>C</h3><a href="/c">C link</a>',
      '<span class="price">$4.00</span><a href="/d">D link</a>',
      '<h3>E</h3>',
    ];
    document.body.innerHTML = cards.map((card) => `<div class="card">${card}</div>`).join('');

    const rows = extract();

    expect(rows.map((row) => row.Title)).toEqual(['A', null, 'C', null, 'E']);
    expect(rows.map((row) => row.Price)).toEqual([1, 2, null, 4, null]);
    expect(rows.map((row) => row.Link)).toEqual([null, expect.stringContaining('/b'), expect.stringContaining('/c'), expect.stringContaining('/d'), null]);
  });

  it('is not misled by a badge in the first record', () => {
    document.body.innerHTML = repeat(
      4,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i === 0 ? '<span class="badge">New</span>' : ''}<span>$${i}.50</span></article>`
    );

    expect(extract().map((row) => row.Price)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it('does not use a position that means different data in different records', () => {
    document.body.innerHTML = repeat(
      4,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i % 2 ? '<span>Sale ends soon</span>' : ''}<span>$${i}.50</span></article>`
    );

    const price = named('Price');

    expect(price?.selector ?? '').not.toContain('nth-child');
    expect(extract().map((row) => row.Price)).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it('offers a rare badge but does not select it by default', () => {
    document.body.innerHTML = repeat(
      8,
      (i) => `<article class="card"><h3>Item ${i}</h3><p>Description for item ${i}.</p>${i === 2 ? '<span class="badge">Sale</span>' : ''}</article>`
    );

    expect(named('Category')?.suggested).toBe(false);
    expect(named('Title')?.suggested).toBe(true);
  });

  it('does not let a rare badge take over the prices of other records', () => {
    document.body.innerHTML = repeat(
      8,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i === 1 ? '<span class="badge">New</span>' : ''}<span>$${i}.50</span></article>`
    );

    const category = named('Category');

    expect(category?.selector).toBe('span.badge');
    expect(category?.coverage).toBe(0.13);
    expect(category?.suggested).toBe(false);
    expect(extract().map((row) => row.Category)).toEqual([null, 'New', null, null, null, null, null, null]);
    expect(extract().map((row) => row.Price)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
  });

  it('keeps a useful column that only some records have, selected', () => {
    document.body.innerHTML = repeat(
      6,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i < 3 ? `<span class="price">$${i}.00</span>` : ''}</article>`
    );

    expect(named('Price')?.coverage).toBeCloseTo(0.5, 2);
    expect(named('Price')?.suggested).toBe(true);
  });

  it('bases coverage and confidence on what was actually found', () => {
    document.body.innerHTML = repeat(
      10,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i % 2 ? `<span class="price">$${i}.00</span>` : ''}</article>`
    );

    expect(named('Title')).toMatchObject({ coverage: 1, sampleSize: 10, confidence: 1 });
    expect(named('Price')).toMatchObject({ coverage: 0.5, sampleSize: 10, occurrences: 5 });
    expect(named('Price')?.confidence).toBeLessThan(1);
  });

  it('counts a selector that finds the wrong kind of value as no evidence', () => {
    document.body.innerHTML = repeat(
      4,
      (i) => `<article class="card"><h3>Item ${i}</h3><span class="amount">${i === 0 ? '$5.00' : 'Ask us'}</span></article>`
    );

    expect(named('Price')?.coverage).toBeCloseTo(0.25, 2);
  });

  it('does not change a row\'s data when the sample is smaller than the list', () => {
    document.body.innerHTML = repeat(
      200,
      (i) => `<article class="card"><h3>Item ${i}</h3><span class="price">$${i}.00</span></article>`
    );

    const price = named('Price');

    expect(price?.sampleSize).toBeLessThan(200);
    expect(price?.occurrences).toBe(200);
    expect(extract()).toHaveLength(200);
  });
});

describe('the content script uses multi-record discovery', () => {
  it('reports columns found after the first record, with their evidence', async () => {
    document.body.innerHTML = repeat(
      4,
      (i) => `<article class="card"><h3>Item ${i}</h3>${i === 0 ? '' : `<span class="price">$${i}.00</span>`}</article>`
    );
    const coordinator = createContentWorkflowCoordinator(() => undefined, document);

    const reply = await coordinator.detectFields({
      id: 'm',
      timestamp: 1,
      type: 'DETECT_FIELDS',
      payload: { containerSelector: '.card' },
    });

    const price = reply.payload.suggestedFields.find((field) => field.name === 'Price');
    expect(price?.discovery).toMatchObject({ coverage: 0.75, sampleSize: 4, suggested: true });
  });
});
