import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { recordsToCsvChunks, recordsToJson } from '@/core/export/exporter';
import type { ExtractedRecord, FieldDefinition } from '@/types';

/**
 * Property-based round trips of the exporters. Random rows (quotes, delimiters, line breaks,
 * emoji, formula-looking text, numbers, missing values) are written, read back with an
 * independent RFC 4180 reader, and compared with what was stored.
 *
 * Properties:
 * - every stored row comes back as exactly one row, with one cell per column, in order;
 *   a missing value never removes or merges a row (AGENTS.md, rule 13);
 * - every value comes back as stored, except text a spreadsheet would run as a formula,
 *   which comes back with the documented "' " prefix and is otherwise unchanged;
 * - nothing that comes back can start a formula that references cells or calls functions.
 */
const SEED = Number(process.env.PH_PROPERTY_SEED ?? 20261118);
const RUNS = Number(process.env.PH_PROPERTY_RUNS ?? 400);

/** An RFC 4180 reader written for this test. The last record may lack its line break. */
function readCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let pending = false; // something was read since the last record ended
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      pending = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      pending = true;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      pending = false;
      i++;
    } else {
      field += ch;
      pending = true;
    }
  }
  if (pending) rows.push([...row, field]);
  return rows;
}

/** Could a spreadsheet run this cell as something more than arithmetic on literal numbers? */
function canRunAsFormula(cell: string): boolean {
  if (/^[\t\r]/.test(cell) && cell.trim().length > 0) return true;
  if (/^\s*[=@]/.test(cell)) return true;
  // A leading sign starts a formula; without letters it can only be arithmetic on literals.
  return /^\s*[+-]/.test(cell) && /[A-DF-Za-df-z]|[eE](?![+-]?\d)/.test(cell);
}

const tricky = fc.constantFrom('"', ',', ';', '\t', '\n', '\r', '\r\n', ' ', '=', '+', '-', '@', "'", 'é', '😀', '€', 'A', '1', '.');
const text = fc.oneof(
  fc.string({ unit: tricky, maxLength: 8 }),
  fc.string({ unit: 'grapheme', maxLength: 8 }),
  fc.constantFrom('=SUM(A1:A2)', '+cmd|/C calc!A0', '-2+3', '@foo', '-5', '+5', '-$5.00', '1e5', '-1.5e-3', '')
);
const cellValue = fc.oneof(
  { arbitrary: text, weight: 6 },
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined)
);

const columnNames = fc.uniqueArray(
  fc.oneof(fc.string({ unit: tricky, minLength: 1, maxLength: 5 }), fc.constantFrom('Title', 'Price', 'Link')),
  { minLength: 1, maxLength: 4 }
).filter((names) => names.every((n) => !n.startsWith('_') && n !== 'datasetId'));

const dataset = columnNames.chain((names) =>
  fc.record({
    names: fc.constant(names),
    rows: fc.array(fc.tuple(...names.map(() => cellValue)), { minLength: 1, maxLength: 12 }),
    delimiter: fc.constantFrom(',', ';', '\t'),
    chunkSize: fc.integer({ min: 1, max: 5 }),
    useBom: fc.boolean(),
  })
);

function toRecords(names: string[], rows: unknown[][]): ExtractedRecord[] {
  return rows.map((values, index) => {
    const record: ExtractedRecord = { _id: `r${index}`, _page: 1, _extractedAt: 1 };
    names.forEach((name, column) => {
      if (values[column] !== undefined) record[name] = values[column] as ExtractedRecord[string];
    });
    return record;
  });
}

function fieldsFor(names: string[]): FieldDefinition[] {
  return names.map((name, index) => ({ id: `f${index}`, name, selector: '.x', extractor: 'text' }));
}

describe('CSV export round trip (property)', () => {
  it('reads back every row, cell and value that was stored, with formulas neutralised', () => {
    fc.assert(
      fc.property(dataset, ({ names, rows, delimiter, chunkSize, useBom }) => {
        const records = toRecords(names, rows);
        let csv = Array.from(recordsToCsvChunks(records, fieldsFor(names), { delimiter, chunkSize, useBom })).join('');
        if (useBom) {
          expect(csv.startsWith('﻿')).toBe(true);
          csv = csv.slice(1);
        }

        const read = readCsv(csv, delimiter);
        expect(read.length, 'one header line, then one line per stored row').toBe(records.length + 1);
        for (const line of read) expect(line).toHaveLength(names.length);

        const cells = [names, ...rows.map((values) => values.map((v) => (v === null || v === undefined ? '' : v)))];
        cells.forEach((values, r) => {
          values.forEach((value, c) => {
            const back = read[r][c];
            const stored = typeof value === 'string' ? value : String(value);
            if (typeof value === 'string' && back !== stored) {
              // The only change allowed is the documented prefix, on text that could run.
              expect(back).toBe(`' ${stored}`);
              expect(canRunAsFormula(stored) || /^\s*[+-]/.test(stored)).toBe(true);
            } else {
              expect(back).toBe(stored);
            }
            expect(canRunAsFormula(back), `cell ${JSON.stringify(back)} could run as a formula`).toBe(false);
          });
        });
      }),
      { seed: SEED, numRuns: RUNS }
    );
  });

  it('keeps a row whose only column is missing, including the last one (a missing field never removes a record)', () => {
    const records = toRecords(['Link'], [['https://a.test'], [undefined], [null]]);
    const csv = Array.from(recordsToCsvChunks(records, fieldsFor(['Link']), {})).join('');
    expect(readCsv(csv, ',')).toEqual([['Link'], ['https://a.test'], [''], ['']]);
    // A reader that skips blank lines still sees every row.
    const nonBlank = csv.split('\r\n').filter((line) => line.length > 0);
    expect(nonBlank).toHaveLength(4);
  });
});

describe('JSON export round trip (property)', () => {
  it('parses back to the stored values for every column, in JSON and NDJSON', () => {
    fc.assert(
      fc.property(dataset, fc.boolean(), fc.constantFrom('json' as const, 'ndjson' as const), ({ names, rows }, pretty, format) => {
        const records = toRecords(names, rows);
        const out = recordsToJson(records, fieldsFor(names), { pretty, format });
        const parsed: Array<Record<string, unknown>> =
          format === 'json' ? JSON.parse(out) : out.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));

        expect(parsed).toHaveLength(records.length);
        parsed.forEach((row, index) => {
          // Provenance is not exported unless asked for.
          expect(Object.keys(row).some((key) => key.startsWith('_'))).toBe(false);
          names.forEach((name, column) => {
            const value = rows[index][column];
            // JSON has no undefined: a missing value is absent; -0 and 0 are the same number.
            if (value === undefined) expect(row).not.toHaveProperty([name]);
            else expect(row[name]).toEqual(Object.is(value, -0) ? 0 : value);
          });
        });
      }),
      { seed: SEED + 1, numRuns: RUNS }
    );
  });
});
