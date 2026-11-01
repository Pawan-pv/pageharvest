import { describe, expect, it } from 'vitest';
import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { DuplicateDetector } from '@/core/extraction/duplicate-detector';
import { FieldDefinition } from '@/types';

const fields: FieldDefinition[] = [{ id: 't', name: 'title', selector: '.t', extractor: 'text' }];

// These two distinct titles produce identical 32-bit FNV-1a signatures ("9699ac42").
// They were found by a birthday search against the original in-page hash.
const COLLIDING_TITLES = ['Product 1079599', 'Product 1262382'];

describe('In-page deduplication never trusts a hash', () => {
  it('keeps two distinct records whose legacy 32-bit hashes collide', () => {
    document.body.innerHTML = COLLIDING_TITLES.map(
      (title) => `<div class="card"><span class="t">${title}</span></div>`
    ).join('');

    const result = extractRecordsFromContainers(
      Array.from(document.querySelectorAll('.card')),
      fields,
      1,
      new Set<string>()
    );

    expect(result.records.map((record) => record.title)).toEqual(COLLIDING_TITLES);
    expect(result.duplicatesCount).toBe(0);
  });

  it('lets the duplicate detector tell them apart', () => {
    const detector = new DuplicateDetector();

    expect(detector.process({ title: COLLIDING_TITLES[0] }).isDuplicate).toBe(false);
    expect(detector.process({ title: COLLIDING_TITLES[1] }).isDuplicate).toBe(false);
    expect(detector.process({ title: COLLIDING_TITLES[0] }).isDuplicate).toBe(true);
  });

  it('keeps records that differ only in letter case, such as product variants', () => {
    document.body.innerHTML = ['SKU-aB3', 'SKU-Ab3']
      .map((title) => `<div class="card"><span class="t">${title}</span></div>`)
      .join('');

    const result = extractRecordsFromContainers(
      Array.from(document.querySelectorAll('.card')),
      fields,
      1,
      new Set<string>()
    );

    expect(result.records).toHaveLength(2);
  });

  it('still drops a true duplicate with only surrounding whitespace differences', () => {
    document.body.innerHTML = ['Laptop Pro', '  Laptop   Pro  ']
      .map((title) => `<div class="card"><span class="t">${title}</span></div>`)
      .join('');

    const result = extractRecordsFromContainers(
      Array.from(document.querySelectorAll('.card')),
      fields,
      1,
      new Set<string>()
    );

    expect(result.records).toHaveLength(1);
    expect(result.duplicatesCount).toBe(1);
  });
});
