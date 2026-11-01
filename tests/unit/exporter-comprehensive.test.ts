import { describe, it, expect } from 'vitest';
import {
  recordsToCsv,
  recordsToJson,
  escapeCsvCell,
  generateExportFilename,
  recordsToCsvChunks,
} from '@/core/export/exporter';
import { ExtractedRecord, FieldDefinition } from '@/types';

describe('Exporter Engine - Comprehensive (Escaping, Unicode, Filenames, Large Datasets)', () => {
  const fields: FieldDefinition[] = [
    { id: '1', name: 'Name', selector: '.title', extractor: 'text' },
    { id: '2', name: 'Price', selector: '.price', extractor: 'number' },
    { id: '3', name: 'Details', selector: '.details', extractor: 'text' },
    { id: '4', name: 'Category', selector: '.cat', extractor: 'text' },
  ];

  describe('Filename Generation & Sanitization', () => {
    it('generates a clean sanitized filename for Windows and Unix file systems', () => {
      const fixedTime = new Date('2026-11-01T10:00:00Z').getTime();

      const csvName = generateExportFilename({
        datasetName: 'Amazon / Laptops : Best <Deals> 2026! *Special*',
        format: 'csv',
        timestamp: fixedTime,
      });

      expect(csvName).not.toContain('/');
      expect(csvName).not.toContain(':');
      expect(csvName).not.toContain('<');
      expect(csvName).not.toContain('>');
      expect(csvName).not.toContain('*');
      expect(csvName).toMatch(/^amazon-laptops-best-deals-2026-special-2026-11-01\.csv$/i);
    });

    it('falls back to default pageharvest_export prefix when name is empty or invalid', () => {
      const name = generateExportFilename({
        datasetName: '   ',
        format: 'json',
      });
      expect(name).toMatch(/^pageharvest-export-\d{4}-\d{2}-\d{2}\.json$/);
    });
  });

  describe('CSV Escaping & Formula Injection Protection', () => {
    it('handles tricky quotes, internal newlines, commas, and formula injection', () => {
      expect(escapeCsvCell('He said: "Wait, don\'t go!"')).toBe('"He said: ""Wait, don\'t go!"""');
      expect(escapeCsvCell('Multi\r\nLine\r\nText')).toBe('"Multi\r\nLine\r\nText"');
      expect(escapeCsvCell('=1+2')).toBe('"\' =1+2"'); // Prepends quote to neutralize spreadsheet formula injection
      expect(escapeCsvCell('+cmd|')).toBe('"\' +cmd|"');
      expect(escapeCsvCell('-calc')).toBe('"\' -calc"');
      expect(escapeCsvCell('@calc')).toBe('"\' @calc"');
    });

    it('supports custom delimiter such as semicolon or tab', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, Name: 'Product A', Price: 25.5, Details: 'Good', Category: 'Tech' },
      ];

      const csvSemicolon = recordsToCsv(records, fields, { delimiter: ';', useBom: false });
      expect(csvSemicolon).toContain('Name;Price;Details;Category');
      expect(csvSemicolon).toContain('Product A;25.5;Good;Tech');

      const tsv = recordsToCsv(records, fields, { delimiter: '\t', useBom: false });
      expect(tsv).toContain('Name\tPrice\tDetails\tCategory');
    });
  });

  describe('Unicode & Multilingual Preservation', () => {
    const unicodeRecords: ExtractedRecord[] = [
      {
        _id: 'u1',
        _page: 1,
        _extractedAt: 100,
        Name: '日本語タイトル (Tokyo Tower 🗼)',
        Price: 1200,
        Details: '中文描述: 很高兴见到你! 🚀',
        Category: 'العربية: مرحباً بك',
      },
      {
        _id: 'u2',
        _page: 1,
        _extractedAt: 200,
        Name: 'Café & Crème Brûlée (Français)',
        Price: 14.5,
        Details: 'Русский: Привет мир! ✨',
        Category: 'Ελληνικά / Hindi: नमस्ते 🙏',
      },
    ];

    it('preserves full Unicode integrity in CSV with UTF-8 BOM', () => {
      const csv = recordsToCsv(unicodeRecords, fields, { useBom: true });
      expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
      expect(csv).toContain('日本語タイトル (Tokyo Tower 🗼)');
      expect(csv).toContain('中文描述: 很高兴见到你! 🚀');
      expect(csv).toContain('العربية: مرحباً بك');
      expect(csv).toContain('Café & Crème Brûlée (Français)');
      expect(csv).toContain('Русский: Привет мир! ✨');
      expect(csv).toContain('Ελληνικά / Hindi: नमस्ते 🙏');
    });

    it('preserves full Unicode integrity in JSON and NDJSON', () => {
      const jsonStr = recordsToJson(unicodeRecords, fields, { pretty: true });
      const parsed = JSON.parse(jsonStr);

      expect(parsed[0].Name).toBe('日本語タイトル (Tokyo Tower 🗼)');
      expect(parsed[0].Details).toBe('中文描述: 很高兴见到你! 🚀');
      expect(parsed[0].Category).toBe('العربية: مرحباً بك');
      expect(parsed[1].Name).toBe('Café & Crème Brûlée (Français)');

      // NDJSON
      const ndjson = recordsToJson(unicodeRecords, fields, { format: 'ndjson' });
      const lines = ndjson.split('\n');
      const row1 = JSON.parse(lines[0]);
      expect(row1.Name).toBe('日本語タイトル (Tokyo Tower 🗼)');
    });
  });

  describe('Stable Column Ordering', () => {
    it('respects custom orderedColumnNames in both CSV and JSON', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, Name: 'Book', Price: 15, Details: 'Great', Category: 'Fiction' },
      ];

      const customOrder = ['Category', 'Price', 'Name'];
      const csv = recordsToCsv(records, fields, { orderedColumns: customOrder, useBom: false });
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('Category,Price,Name');
      expect(lines[1]).toBe('Fiction,15,Book');

      const jsonStr = recordsToJson(records, fields, { orderedColumns: customOrder, pretty: false });
      const parsed = JSON.parse(jsonStr);
      // Verify keys in the exported object match the custom order exactly
      expect(Object.keys(parsed[0])).toEqual(customOrder);
    });
  });

  describe('Large Dataset Streaming & Chunking', () => {
    it('processes 5,000 records in chunked batches without freezing', () => {
      const count = 5000;
      const largeRecords: ExtractedRecord[] = [];
      for (let i = 1; i <= count; i++) {
        largeRecords.push({
          _id: `rec_${i}`,
          _page: 1,
          _extractedAt: 1000 + i,
          Name: `Item #${i}`,
          Price: i * 2.5,
          Details: `Description of item ${i} with, comma and "quotes"`,
          Category: `Cat ${i % 10}`,
        });
      }

      const chunks = Array.from(recordsToCsvChunks(largeRecords, fields, { chunkSize: 1000 }));
      expect(chunks.length).toBeGreaterThan(1);

      // Verify full CSV string concatenation
      const fullCsv = chunks.join('');
      const rows = fullCsv.split('\r\n').filter((l) => l.trim().length > 0);
      // 1 header + 5000 records
      expect(rows.length).toBe(5001);
    });
  });

  describe('Export Integrity & Round-Trip', () => {
    it('preserves exact cell values during round-trip', () => {
      const records: ExtractedRecord[] = [
        { _id: '1', _page: 1, _extractedAt: 100, Name: 'Item 1', Price: 99.99, Details: 'Special, "Edition"' },
      ];

      const json = recordsToJson(records, fields);
      const parsedJson = JSON.parse(json);
      expect(parsedJson[0].Name).toBe(records[0].Name);
      expect(parsedJson[0].Price).toBe(records[0].Price);
      expect(parsedJson[0].Details).toBe(records[0].Details);
    });
  });
});
