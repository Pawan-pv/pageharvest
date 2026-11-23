import { describe, it, expect } from 'vitest';
import {
  columnValues,
  dataColumnNames,
  detectColumnKind,
  detectImageColumns,
  detectUrlColumns,
  describeSmartClean,
  isImageUrl,
  isWebUrl,
  mergeColumns,
  smartClean,
} from '@/components/grid/grid-features';
import type { ExtractedRecord, FieldDefinition } from '@/types';

const field = (id: string, name: string): FieldDefinition => ({
  id,
  name,
  selector: '',
  extractor: 'text',
});

const record = (overrides: Record<string, unknown>): ExtractedRecord =>
  ({
    _id: 'r1',
    _page: 1,
    _extractedAt: 1,
    ...overrides,
  } as ExtractedRecord);

describe('isImageUrl', () => {
  it('recognises common image extensions', () => {
    expect(isImageUrl('https://example.com/a.png')).toBe(true);
    expect(isImageUrl('https://example.com/a.JPG')).toBe(true);
    expect(isImageUrl('https://example.com/a.jpeg')).toBe(true);
    expect(isImageUrl('https://example.com/a.gif')).toBe(true);
    expect(isImageUrl('https://example.com/a.webp')).toBe(true);
    expect(isImageUrl('https://example.com/a.svg')).toBe(true);
    expect(isImageUrl('data:image/png;base64,abc')).toBe(true);
  });

  it('rejects non-images and non-urls', () => {
    expect(isImageUrl('https://example.com/page.html')).toBe(false);
    expect(isImageUrl('not a url')).toBe(false);
    expect(isImageUrl('')).toBe(false);
    expect(isImageUrl(null)).toBe(false);
    expect(isImageUrl(undefined)).toBe(false);
    expect(isImageUrl('ftp://example.com/a.png')).toBe(false);
  });
});

describe('isWebUrl', () => {
  it('accepts http and https absolute URLs', () => {
    expect(isWebUrl('https://example.com/')).toBe(true);
    expect(isWebUrl('http://localhost:3000/path')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isWebUrl('ftp://example.com/')).toBe(false);
    expect(isWebUrl('mailto:a@b.com')).toBe(false);
    expect(isWebUrl('not a url')).toBe(false);
    expect(isWebUrl('')).toBe(false);
    expect(isWebUrl(null)).toBe(false);
  });
});

describe('detectColumnKind', () => {
  const rows = (values: unknown[]): ExtractedRecord[] =>
    values.map((v, i) => record({ [`col`]: v, _id: `r${i}` }));

  it('detects an image column when most cells are images', () => {
    const records = rows(['https://example.com/a.png', 'https://example.com/b.jpg', 'n/a']);
    expect(detectColumnKind(records, 'col')).toBe('image');
  });

  it('detects a url column when most cells are web URLs', () => {
    const records = rows(['https://example.com/a', 'https://example.com/b', 'n/a']);
    expect(detectColumnKind(records, 'col')).toBe('url');
  });

  it('defaults to text when no majority is images or URLs', () => {
    const records = rows(['hello', 'world', 'n/a']);
    expect(detectColumnKind(records, 'col')).toBe('text');
  });

  it('returns text for an empty column', () => {
    expect(detectColumnKind([], 'col')).toBe('text');
  });
});

describe('detectImageColumns / detectUrlColumns', () => {
  const fields: FieldDefinition[] = [field('f1', 'Image'), field('f2', 'Link'), field('f3', 'Name')];
  const records: ExtractedRecord[] = [
    record({ Image: 'https://example.com/a.png', Link: 'https://example.com/a', Name: 'A' }),
    record({ Image: 'https://example.com/b.png', Link: 'https://example.com/b', Name: 'B' }),
    record({ Image: 'n/a', Link: 'n/a', Name: 'C' }),
  ];

  it('detects image columns', () => {
    expect(detectImageColumns(records, fields)).toEqual(['Image']);
  });

  it('detects URL columns', () => {
    expect(detectUrlColumns(records, fields)).toEqual(['Link']);
  });
});

describe('columnValues', () => {
  it('returns trimmed non-empty string values in row order', () => {
    const records: ExtractedRecord[] = [
      record({ Name: '  Alice  ', _id: 'r1' }),
      record({ Name: '', _id: 'r2' }),
      record({ Name: null, _id: 'r3' }),
      record({ Name: 'Bob', _id: 'r4' }),
      record({ _id: 'r5' }),
    ];
    expect(columnValues(records, 'Name')).toEqual(['Alice', 'Bob']);
  });
});

describe('mergeColumns', () => {
  const fields: FieldDefinition[] = [field('f1', 'First'), field('f2', 'Last'), field('f3', 'City')];
  const records: ExtractedRecord[] = [
    record({ First: 'Jane', Last: 'Doe', City: 'NYC' }),
    record({ First: 'John', Last: '', City: 'LA' }),
    record({ First: '', Last: 'Smith', City: '' }),
  ];

  it('joins selected columns with a delimiter and drops blanks', () => {
    const { records: merged, fields: nextFields } = mergeColumns(records, fields, {
      columns: ['First', 'Last'],
      delimiter: ' ',
      newName: 'Full Name',
      dropSources: true,
    });

    expect(merged).toEqual([
      record({ 'Full Name': 'Jane Doe', City: 'NYC' }),
      record({ 'Full Name': 'John', City: 'LA' }),
      record({ 'Full Name': 'Smith', City: '' }),
    ]);
    expect(nextFields.map((f) => f.name)).toEqual(['Full Name', 'City']);
  });

  it('keeps source columns when dropSources is false', () => {
    const { records: merged, fields: nextFields } = mergeColumns(records, fields, {
      columns: ['First', 'Last'],
      delimiter: ' / ',
      newName: 'Full Name',
      dropSources: false,
    });

    expect(merged[0]['Full Name']).toBe('Jane / Doe');
    expect(nextFields.map((f) => f.name)).toEqual(['First', 'Last', 'Full Name', 'City']);
  });

  it('throws when fewer than two columns are selected', () => {
    expect(() =>
      mergeColumns(records, fields, {
        columns: ['First'],
        delimiter: ' ',
        newName: 'X',
        dropSources: false,
      })
    ).toThrow(/at least two columns/);
  });

  it('throws when the new name collides with an existing column', () => {
    expect(() =>
      mergeColumns(records, fields, {
        columns: ['First', 'Last'],
        delimiter: ' ',
        newName: 'City',
        dropSources: false,
      })
    ).toThrow(/already a column named/);
  });

  it('throws when a selected column no longer exists', () => {
    expect(() =>
      mergeColumns(records, fields, {
        columns: ['First', 'Missing'],
        delimiter: ' ',
        newName: 'X',
        dropSources: false,
      })
    ).toThrow(/no longer in this table/);
  });
});

describe('smartClean', () => {
  it('trims, removes empty rows and duplicates, and drops empty columns', () => {
    const fields: FieldDefinition[] = [field('f1', 'Name'), field('f2', 'Age'), field('f3', 'Empty')];
    const records: ExtractedRecord[] = [
      record({ Name: '  Alice  ', Age: '30', Empty: '' }),
      record({ Name: 'Alice', Age: '30', Empty: '' }),
      record({ Name: '', Age: '', Empty: '' }),
      record({ Name: 'Bob', Age: '', Empty: '' }),
    ];

    const result = smartClean(records, fields);

    expect(result.records.map((r) => r.Name)).toEqual(['Alice', 'Bob']);
    expect(result.summary).toEqual({
      trimmedCells: 1,
      emptyRowsRemoved: 1,
      duplicatesRemoved: 1,
      emptyColumnsRemoved: 1,
    });
    expect(result.fields.map((f) => f.name)).not.toContain('Empty');
  });

  it('reports nothing changed when the table is already tidy', () => {
    const fields: FieldDefinition[] = [field('f1', 'Name')];
    const records: ExtractedRecord[] = [record({ Name: 'Alice' })];
    const result = smartClean(records, fields);
    expect(result.summary).toEqual({
      trimmedCells: 0,
      emptyRowsRemoved: 0,
      duplicatesRemoved: 0,
      emptyColumnsRemoved: 0,
    });
  });
});

describe('describeSmartClean', () => {
  it('describes each change', () => {
    expect(describeSmartClean({ trimmedCells: 3, emptyRowsRemoved: 1, duplicatesRemoved: 2, emptyColumnsRemoved: 0 })).toBe(
      'Smart Clean: trimmed 3 cells, removed 1 empty row, removed 2 duplicates.'
    );
  });

  it('says everything is tidy when nothing changed', () => {
    expect(describeSmartClean({ trimmedCells: 0, emptyRowsRemoved: 0, duplicatesRemoved: 0, emptyColumnsRemoved: 0 })).toBe(
      'Everything is already tidy. Nothing needed changing.'
    );
  });
});

describe('dataColumnNames', () => {
  it('returns field names in display order', () => {
    const fields: FieldDefinition[] = [field('f1', 'Name'), field('f2', 'Price')];
    const records: ExtractedRecord[] = [record({ Name: 'A' })];
    expect(dataColumnNames(records, fields)).toEqual(['Name', 'Price']);
  });

  it('falls back to record keys excluding metadata', () => {
    const fields: FieldDefinition[] = [];
    const records: ExtractedRecord[] = [
      record({ Name: 'A', _id: 'x', _page: 1, _extractedAt: 1 }),
    ];
    expect(dataColumnNames(records, fields)).toEqual(['Name']);
  });
});
