import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { recordsToXlsx, recordsToXlsxBuffer, recordsToXlsxBlob } from '@/core/export/exporter';
import { ExtractedRecord, FieldDefinition } from '@/types';

describe('XLSX export', () => {
  const fields: FieldDefinition[] = [
    { id: '1', name: 'Product Name', selector: '.name', extractor: 'text' },
    { id: '2', name: 'Price', selector: '.price', extractor: 'number' },
  ];

  const sampleRecords: ExtractedRecord[] = [
    { _id: 'rec-1', _page: 1, _extractedAt: 1700000000, 'Product Name': 'Widget "A"', Price: 9.99 },
    { _id: 'rec-2', _page: 1, _extractedAt: 1700000010, 'Product Name': 'Gadget', Price: 19.5 },
  ];

  it('produces a non-empty Uint8Array starting with PK zip signature', () => {
    const bytes = recordsToXlsx(sampleRecords, fields);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
  });

  it('creates a valid zip with expected entries and worksheet content', async () => {
    const bytes = recordsToXlsx(sampleRecords, fields);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain('xl/worksheets/sheet1.xml');
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('Widget');
    expect(sheet).toContain('9.99');
    expect(sheet).toContain('Product Name');
  });

  it('excludes metadata by default', async () => {
    const bytes = recordsToXlsx(sampleRecords, fields);
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).not.toContain('_id');
  });

  it('includes metadata when requested', async () => {
    const bytes = recordsToXlsx(sampleRecords, undefined, { includeMetadata: true });
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('_id');
  });

  it('handles empty records', () => {
    const bytes = recordsToXlsx([], fields);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('buffer and blob helpers work', async () => {
    const buf = recordsToXlsxBuffer(sampleRecords, fields);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    const blob = recordsToXlsxBlob(sampleRecords, fields);
    expect(blob.type).toContain('spreadsheetml');
  });
});