import { describe, expect, it } from 'vitest';
import { escapeCsvCell, recordsToCsv } from '@/core/export/exporter';
import { ExtractedRecord, FieldDefinition } from '@/types';

describe('CSV formula protection preserves legitimate values', () => {
  describe('numeric values are never altered', () => {
    it.each([
      [-5, '-5'],
      [-12.5, '-12.5'],
      [5, '5'],
      [0, '0'],
    ])('numeric %s stays %s', (value, expected) => {
      expect(escapeCsvCell(value)).toBe(expected);
    });

    it.each(['-5', '-12.50', '+5', '0', '-0.75', '+3.14', '1e5', '-1.5E-3'])(
      'numeric string %s stays intact',
      (value) => {
        expect(escapeCsvCell(value)).toBe(value);
      }
    );

    it('keeps formatted numeric text that cannot execute', () => {
      expect(escapeCsvCell('-$5.00')).toBe('-$5.00');
      expect(escapeCsvCell('-€1299.50')).toBe('-€1299.50');
      expect(escapeCsvCell('+1 (555) 123-4567')).toBe('+1 (555) 123-4567');
      expect(escapeCsvCell('-15%')).toBe('-15%');
    });

    it('still quotes a thousands separator so the delimiter stays intact', () => {
      expect(escapeCsvCell('-1,299.50')).toBe('"-1,299.50"');
    });
  });

  describe('formula-like text is neutralized', () => {
    it.each([
      ['=SUM(A1:A5)', `"' =SUM(A1:A5)"`],
      ['=1+2', `"' =1+2"`],
      ['+cmd|', `"' +cmd|"`],
      ["+cmd|' /C calc'!A0", `"' +cmd|' /C calc'!A0"`],
      ['-calc', `"' -calc"`],
      ['-FORMULA(A1)', `"' -FORMULA(A1)"`],
      ['-2+3+cmd', `"' -2+3+cmd"`],
      ['@calc', `"' @calc"`],
      ['@SUM(A1)', `"' @SUM(A1)"`],
    ])('%s is protected', (value, expected) => {
      expect(escapeCsvCell(value)).toBe(expected);
    });

    it.each([
      '  =SUM(A1:A5)',
      '\t=SUM(A1:A5)',
      '\r=SUM(A1:A5)',
      '\n=SUM(A1:A5)',
      '   +cmd|',
      ' -FORMULA(A1)',
      ' @SUM(A1)',
    ])('leading whitespace does not bypass protection: %j', (value) => {
      const escaped = escapeCsvCell(value);
      expect(escaped.startsWith(`"'`)).toBe(true);
      expect(escaped).toContain(value.trim());
    });

    it('protects a formula that also contains CSV metacharacters', () => {
      expect(escapeCsvCell('=HYPERLINK("http://x","y")')).toBe(`"' =HYPERLINK(""http://x"",""y"")"`);
    });

    it('does not treat text with an interior formula character as a formula', () => {
      expect(escapeCsvCell('a=b')).toBe('a=b');
      expect(escapeCsvCell('user@example.com')).toBe('user@example.com');
      expect(escapeCsvCell('well-known')).toBe('well-known');
    });
  });

  describe('RFC 4180 escaping is unchanged', () => {
    it('escapes quotes, commas, semicolons, tabs and newlines', () => {
      expect(escapeCsvCell('He said "Hi"')).toBe('"He said ""Hi"""');
      expect(escapeCsvCell('Hello, World')).toBe('"Hello, World"');
      expect(escapeCsvCell('a;b')).toBe('"a;b"');
      expect(escapeCsvCell('a\tb')).toBe('"a\tb"');
      expect(escapeCsvCell('Row 1\nRow 2')).toBe('"Row 1\nRow 2"');
      expect(escapeCsvCell('Row 1\r\nRow 2')).toBe('"Row 1\r\nRow 2"');
    });

    it('keeps Unicode intact', () => {
      expect(escapeCsvCell('Café — 日本語 ₹1299 🌾')).toBe('Café — 日本語 ₹1299 🌾');
    });

    it('renders null and undefined as empty cells and booleans as text', () => {
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell(undefined)).toBe('');
      expect(escapeCsvCell(true)).toBe('true');
    });
  });

  it('serializes a whole dataset with every value class in one file', () => {
    const fields: FieldDefinition[] = [
      { id: 'a', name: 'Name', selector: '.a', extractor: 'text' },
      { id: 'b', name: 'Delta', selector: '.b', extractor: 'number' },
      { id: 'c', name: 'Note', selector: '.c', extractor: 'text' },
    ];
    const records: ExtractedRecord[] = [
      { _id: '1', _page: 1, _extractedAt: 1, Name: 'Widget, "Pro"', Delta: -5, Note: '=SUM(A1:A5)' },
      { _id: '2', _page: 1, _extractedAt: 1, Name: 'Café', Delta: -12.5, Note: 'line1\nline2' },
      { _id: '3', _page: 1, _extractedAt: 1, Name: '日本語', Delta: 0, Note: null },
    ];

    expect(recordsToCsv(records, fields, { useBom: false })).toBe(
      [
        'Name,Delta,Note',
        `"Widget, ""Pro""",-5,"' =SUM(A1:A5)"`,
        'Café,-12.5,"line1\nline2"',
        '日本語,0,',
      ].join('\r\n')
    );
  });
});
