import { describe, it, expect } from 'vitest';
import { recordsToCsv, recordsToJson, escapeCsvCell } from '@/core/export/exporter';
import { ExtractedRecord, FieldDefinition } from '@/types';

describe('Export Pipeline (CSV & JSON)', () => {
  const fields: FieldDefinition[] = [
    { id: '1', name: 'Product Name', selector: '.name', extractor: 'text' },
    { id: '2', name: 'Price', selector: '.price', extractor: 'number' },
    { id: '3', name: 'Description', selector: '.desc', extractor: 'text' },
  ];

  const sampleRecords: ExtractedRecord[] = [
    {
      _id: 'rec-1',
      _page: 1,
      _extractedAt: 1700000000,
      'Product Name': 'Wireless "Ultra" Headphones',
      Price: 99.99,
      Description: 'Line 1,\nLine 2 with comma',
    },
    {
      _id: 'rec-2',
      _page: 1,
      _extractedAt: 1700000010,
      'Product Name': 'Standard Mouse',
      Price: 19.5,
      Description: 'Simple desc',
    },
  ];

  it('properly escapes quotes, commas, and newlines in CSV cells', () => {
    expect(escapeCsvCell('Simple')).toBe('Simple');
    expect(escapeCsvCell('Hello, World')).toBe('"Hello, World"');
    expect(escapeCsvCell('He said "Hi"')).toBe('"He said ""Hi"""');
    expect(escapeCsvCell('Row 1\nRow 2')).toBe('"Row 1\nRow 2"');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(123.45)).toBe('123.45');
  });

  it('exports RFC 4180 CSV excluding internal metadata by default', () => {
    const csv = recordsToCsv(sampleRecords, fields, { includeMetadata: false, useBom: false });
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('Product Name,Price,Description');
    // First record has quotes and commas escaped
    expect(lines).toContain('Standard Mouse,19.5,Simple desc');
    expect(csv).not.toContain('_id');
    expect(csv).not.toContain('_page');
  });

  it('prepends UTF-8 BOM when requested', () => {
    const csv = recordsToCsv(sampleRecords, fields, { useBom: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('exports clean JSON excluding internal metadata', () => {
    const jsonStr = recordsToJson(sampleRecords, fields, { includeMetadata: false, pretty: true });
    const parsed = JSON.parse(jsonStr);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]['Product Name']).toBe('Wireless "Ultra" Headphones');
    expect(parsed[0].Price).toBe(99.99);
    expect(parsed[0]._id).toBeUndefined();
    expect(parsed[0]._page).toBeUndefined();
  });

  it('exports NDJSON when specified', () => {
    const ndjson = recordsToJson(sampleRecords, fields, { format: 'ndjson' });
    const lines = ndjson.trim().split('\n');
    expect(lines).toHaveLength(2);
    const row1 = JSON.parse(lines[0]);
    expect(row1['Product Name']).toBe('Wireless "Ultra" Headphones');
  });

  it('handles empty records cleanly', () => {
    expect(recordsToCsv([], fields)).toBe('');
    expect(recordsToJson([], fields)).toBe('[]');
  });
});
