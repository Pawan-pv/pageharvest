import { ExtractedRecord, FieldDefinition } from '@/types';
import { isRecordMetadataKey } from '@/shared/contracts/record';

export interface CsvExportOptions {
  includeMetadata?: boolean; // If true, includes _id, _page, _extractedAt
  useBom?: boolean;          // Prepends \uFEFF for Excel UTF-8 compatibility
  delimiter?: string;        // Default: ','
  orderedColumns?: string[]; // Custom column sequence
  chunkSize?: number;        // Batch size for streaming
}

export interface JsonExportOptions {
  includeMetadata?: boolean;
  pretty?: boolean;
  indent?: number;
  format?: 'json' | 'ndjson';
  orderedColumns?: string[];
}

export interface FilenameOptions {
  datasetName?: string;
  projectName?: string;
  format: 'csv' | 'json' | 'ndjson';
  timestamp?: number;
}

/**
 * Sanitizes a string into a cross-platform safe filename (Windows, macOS, Linux).
 */
export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\\/:*?"<>|]/g, ' ')      // Replace illegal OS chars with space
    .replace(/[^\w\s-]/g, '')           // Strip punctuation
    .trim()
    .replace(/\s+/g, '-')               // Replace spaces with hyphens
    .replace(/-+/g, '-');               // Collapse consecutive hyphens
}

/**
 * Generates an appropriate export filename with current or provided timestamp.
 * e.g. "amazon-laptops-2026-11-01.csv"
 */
export function generateExportFilename(options: FilenameOptions): string {
  const rawBase = (options.datasetName || options.projectName || '').trim();
  const sanitized = sanitizeFilename(rawBase);
  const baseName = sanitized.length > 0 ? sanitized : 'pageharvest-export';

  const dateObj = options.timestamp ? new Date(options.timestamp) : new Date();
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const extension = options.format === 'ndjson' ? 'ndjson' : options.format === 'json' ? 'json' : 'csv';

  return `${baseName}-${dateStr}.${extension}`;
}

/** A cell whose first visible character can start a spreadsheet formula. */
const FORMULA_TRIGGER = /^\s*[=+\-@]/;

/**
 * Signed values that spreadsheets read as data, not as a formula: plain and
 * scientific numbers, currency amounts, percentages and phone numbers. Letters
 * (other than an exponent), operators and function calls never match, so anything
 * able to reference a cell or run a command is still neutralized.
 */
const SIGNED_NUMERIC_VALUE =
  /^[+-]\s?[$€£¥₹]?\s?\d[\d,.\s]*(?:[eE][+-]?\d+)?\s?%?$|^[+-][$€£¥₹]?\.\d+$|^\+?[\d\s().-]*\(\d+\)[\d\s().-]*$/;

function isFormulaLike(text: string): boolean {
  // A leading tab or carriage return can also begin a formula in some spreadsheets.
  if (/^[\t\r]/.test(text) && text.trim().length > 0) return true;
  if (!FORMULA_TRIGGER.test(text)) return false;
  return !SIGNED_NUMERIC_VALUE.test(text.trim());
}

/**
 * Escapes a value for RFC 4180 CSV compliance and neutralizes formula injection.
 *
 * JavaScript numbers and booleans are written unchanged. Text that could execute as
 * a formula is prefixed with an apostrophe and a space; signed numeric text such as
 * "-5", "-12.50", "+5" or "-$5.00" is data and is left exactly as extracted.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  const isFormula = typeof value === 'string' && isFormulaLike(str);
  if (isFormula) {
    str = `' ${str}`;
  }

  // If cell contains commas, semicolons, tabs, quotes, or newlines, wrap in quotes and escape internal quotes
  if (
    str.includes(',') ||
    str.includes(';') ||
    str.includes('\t') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r') ||
    isFormula
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Resolves column names according to user preferences and ordering.
 */
function resolveColumns(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options?: { includeMetadata?: boolean; orderedColumns?: string[] }
): string[] {
  if (options?.orderedColumns && options.orderedColumns.length > 0) {
    return options.orderedColumns;
  }

  const columnNames = fields && fields.length > 0
    ? fields.map((f) => f.name)
    : (() => {
    // Dynamic keys from records
    const keySet = new Set<string>();
    for (const r of records) {
      Object.keys(r).forEach((k) => keySet.add(k));
    }
    return Array.from(keySet);
  })();

  if (!options?.includeMetadata) {
    return columnNames.filter((col) => !isRecordMetadataKey(col));
  }

  return columnNames;
}

/**
 * Generator producing CSV content in chunks to support very large datasets.
 */
export function* recordsToCsvChunks(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: CsvExportOptions = {}
): Generator<string> {
  if (records.length === 0) {
    return;
  }

  const delimiter = options.delimiter || ',';
  const columnNames = resolveColumns(records, fields, options);
  const chunkSize = options.chunkSize || 1000;

  // Header line
  let header = columnNames.map(escapeCsvCell).join(delimiter) + '\r\n';
  if (options.useBom) {
    header = `\uFEFF${header}`;
  }
  yield header;

  // Stream records in chunks
  let currentChunk: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const row = columnNames.map((col) => escapeCsvCell(record[col])).join(delimiter);
    currentChunk.push(row);

    if (currentChunk.length >= chunkSize) {
      yield currentChunk.join('\r\n') + '\r\n';
      currentChunk = [];
    }
  }

  if (currentChunk.length > 0) {
    yield currentChunk.join('\r\n');
  }
}

/**
 * Converts extracted records into RFC 4180 CSV format.
 */
export function recordsToCsv(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: CsvExportOptions = { includeMetadata: false, useBom: true }
): string {
  if (records.length === 0) {
    return '';
  }

  let csv = '';
  for (const chunk of recordsToCsvChunks(records, fields, options)) {
    csv += chunk;
  }
  return csv;
}

/**
 * Converts extracted records into formatted JSON or NDJSON.
 */
export function recordsToJson(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: JsonExportOptions = { includeMetadata: false, pretty: true, format: 'json' }
): string {
  if (records.length === 0) {
    return options.format === 'ndjson' ? '' : '[]';
  }

  const allowedCols = resolveColumns(records, fields, options);

  const cleanRecords = records.map((r) => {
    const cleaned: Record<string, unknown> = {};
    for (const key of allowedCols) {
      if (Object.prototype.hasOwnProperty.call(r, key)) {
        cleaned[key] = r[key];
      }
    }
    return cleaned;
  });

  if (options.format === 'ndjson') {
    return cleanRecords.map((r) => JSON.stringify(r)).join('\n');
  }

  return JSON.stringify(cleanRecords, null, options.pretty ? (options.indent ?? 2) : undefined);
}
