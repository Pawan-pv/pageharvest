import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  normalizeForComparison,
  summarizeResults,
} from '@/../scripts/benchmark/metrics.mjs';

const TITLE = { name: 'Title', kind: 'text' as const };
const PRICE = { name: 'Price', kind: 'number' as const, numberFormat: 'us' as const };
const truth = [
  { Title: 'A', Price: '$1.50' },
  { Title: 'B', Price: '$2.50' },
  { Title: 'C', Price: '$3.50' },
  { Title: 'D', Price: '$4.50' },
];
const score = (rows: Array<Record<string, unknown>>, pagesVisited = 1, expectedPages = 1) =>
  computeMetrics({ truthRecords: truth, rows, key: 'Title', fields: [TITLE, PRICE], pagesVisited, expectedPages });

describe('comparing values', () => {
  it('collapses whitespace in text, and keeps case', () => {
    expect(normalizeForComparison(' A\n  b ', TITLE)).toBe('A b');
    expect(normalizeForComparison('a b', TITLE)).not.toBe(normalizeForComparison('A B', TITLE));
  });

  it('reads a number in the format the site writes it', () => {
    expect(normalizeForComparison('$1,234.50', { name: 'P', kind: 'number', numberFormat: 'us' })).toBe(1234.5);
    expect(normalizeForComparison('1.234,50 €', { name: 'P', kind: 'number', numberFormat: 'eu' })).toBe(1234.5);
    expect(normalizeForComparison(1234.5, { name: 'P', kind: 'number', numberFormat: 'eu' })).toBe(1234.5);
  });

  it('treats no value as null', () => {
    expect(normalizeForComparison('', TITLE)).toBeNull();
    expect(normalizeForComparison(null, TITLE)).toBeNull();
  });
});

describe('computeMetrics', () => {
  it('scores a perfect extraction as 1 throughout', () => {
    const result = score([
      { Title: 'A', Price: 1.5 },
      { Title: 'B', Price: 2.5 },
      { Title: 'C', Price: 3.5 },
      { Title: 'D', Price: 4.5 },
    ]);

    expect(result).toMatchObject({
      precision: 1,
      recall: 1,
      fieldAccuracy: 1,
      fieldCompleteness: 1,
      duplicateRate: 0,
      pageCoverage: 1,
    });
  });

  it('lowers recall for records it did not find', () => {
    const result = score([{ Title: 'A', Price: 1.5 }]);

    expect(result.recall).toBe(0.25);
    expect(result.precision).toBe(1);
  });

  it('lowers precision for rows that are not records, such as menu items', () => {
    const result = score([
      { Title: 'A', Price: 1.5 },
      { Title: 'Home', Price: null },
      { Title: 'Contact', Price: null },
      { Title: 'About', Price: null },
    ]);

    expect(result.precision).toBe(0.25);
    expect(result.recall).toBe(0.25);
  });

  it('scores a wrong value as inaccurate, not just incomplete', () => {
    const result = score([
      { Title: 'A', Price: 9.99 },
      { Title: 'B', Price: 2.5 },
      { Title: 'C', Price: 3.5 },
      { Title: 'D', Price: 4.5 },
    ]);

    expect(result.perField.Price).toMatchObject({ accuracy: 0.75, completeness: 1 });
    expect(result.fieldAccuracy).toBeCloseTo(0.875, 3);
  });

  it('scores an empty value as incomplete, not as a wrong value', () => {
    const result = score([
      { Title: 'A', Price: null },
      { Title: 'B', Price: 2.5 },
      { Title: 'C', Price: 3.5 },
      { Title: 'D', Price: 4.5 },
    ]);

    expect(result.perField.Price).toMatchObject({ accuracy: 1, completeness: 0.75 });
  });

  it('finds a column under any name, because the extension names columns itself', () => {
    const result = score([
      { Heading: 'A', Text: 1.5 },
      { Heading: 'B', Text: 2.5 },
      { Heading: 'C', Text: 3.5 },
      { Heading: 'D', Text: 4.5 },
    ]);

    expect(result.recall).toBe(1);
    expect(result.perField.Price).toMatchObject({ column: 'Text', accuracy: 1 });
  });

  it('scores a field no column holds as completely missing', () => {
    const result = score([
      { Title: 'A' },
      { Title: 'B' },
      { Title: 'C' },
      { Title: 'D' },
    ]);

    expect(result.perField.Price).toMatchObject({ column: null, completeness: 0 });
    expect(result.fieldCompleteness).toBe(0.5);
  });

  it('counts repeated records as duplicates', () => {
    const result = score([
      { Title: 'A', Price: 1.5 },
      { Title: 'A', Price: 1.5 },
      { Title: 'B', Price: 2.5 },
      { Title: 'C', Price: 3.5 },
    ]);

    expect(result.duplicateRate).toBe(0.25);
    expect(result.recall).toBe(0.75);
  });

  it('reports pages visited against pages expected', () => {
    expect(score([], 1, 3).pageCoverage).toBeCloseTo(1 / 3, 3);
    expect(score([], 5, 3).pageCoverage).toBe(1);
  });

  it('scores zero, not an error, when nothing was extracted', () => {
    expect(score([])).toMatchObject({ precision: 0, recall: 0, fieldAccuracy: 0, fieldCompleteness: 0, duplicateRate: 0 });
  });

  it('does not count a page repeating a record as a second truth record', () => {
    const result = computeMetrics({
      truthRecords: [...truth, truth[0]],
      rows: truth.map((row) => ({ Title: row.Title, Price: Number(row.Price.slice(1)) })),
      key: 'Title',
      fields: [TITLE, PRICE],
      pagesVisited: 1,
      expectedPages: 1,
    });

    expect(result.recall).toBe(1);
    expect(result.truthCount).toBe(4);
  });
});

describe('summarizeResults', () => {
  it('averages only sites that ran, and counts the rest', () => {
    const ran = { id: 'a', status: 'PASS', metrics: { precision: 1, recall: 0.5, fieldAccuracy: 1, fieldCompleteness: 0.5, duplicateRate: 0, pageCoverage: 1 } };
    const failed = { id: 'b', status: 'FAIL', metrics: { precision: 0, recall: 0, fieldAccuracy: 0, fieldCompleteness: 0, duplicateRate: 0, pageCoverage: 0 } };
    const blocked = { id: 'c', status: 'BLOCKED' };

    const summary = summarizeResults([ran, failed, blocked]);

    expect(summary).toMatchObject({ total: 3, passed: 1, failed: 1, blocked: 1 });
    expect(summary.mean.recall).toBe(0.25);
  });
});
