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
  chunkSize?: number;
}

/** Options for recordsToXlsx in ./xlsx, which is loaded only when exporting to Excel. */
export interface XlsxExportOptions {
  includeMetadata?: boolean;
  orderedColumns?: string[];
  sheetName?: string;
}

export interface FilenameOptions {
  datasetName?: string;
  projectName?: string;
  format: 'csv' | 'json' | 'ndjson' | 'xlsx';
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

  const extension =
    options.format === 'ndjson'
      ? 'ndjson'
      : options.format === 'json'
        ? 'json'
        : options.format === 'xlsx'
          ? 'xlsx'
          : 'csv';
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
export function resolveColumns(
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

interface StoredValueNote {
  raw?: string;
  status?: string;
  currency?: string;
  currencySymbol?: string;
  min?: number;
  max?: number;
}

function readValueNotes(record: ExtractedRecord): Record<string, StoredValueNote> {
  const stored = record._valueNotes;
  if (typeof stored !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredValueNote>) : {};
  } catch {
    return {};
  }
}

/** Values kept as text because they could not be read as one number with certainty. */
export function countValuesNeedingReview(records: ExtractedRecord[]): number {
  let count = 0;
  for (const record of records) {
    for (const note of Object.values(readValueNotes(record))) {
      if (note.status === 'ambiguous') count += 1;
    }
  }
  return count;
}

/**
 * Adds how each number was read as extra columns: the original text, its status, the
 * currency and the two ends of a range. Rows keep their values; nothing is replaced.
 */
export function withValueDetails(
  records: ExtractedRecord[],
  fields: FieldDefinition[] | undefined
): { records: ExtractedRecord[]; fields: FieldDefinition[] | undefined; detailColumns: string[] } {
  const notedFields = new Set<string>();
  const notesByRecord = records.map((record) => {
    const notes = readValueNotes(record);
    Object.keys(notes).forEach((name) => notedFields.add(name));
    return notes;
  });
  if (notedFields.size === 0) return { records, fields, detailColumns: [] };

  const columnsOf = (name: string) =>
    ['original', 'status', 'currency', 'min', 'max'].map((detail) => `${name} (${detail})`);
  const expanded = records.map((record, index) => {
    const copy: ExtractedRecord = { ...record };
    for (const name of notedFields) {
      const note = notesByRecord[index][name];
      const [original, status, currency, min, max] = columnsOf(name);
      copy[original] = note?.raw ?? null;
      copy[status] = note?.status ?? null;
      copy[currency] = note?.currency ?? note?.currencySymbol ?? null;
      copy[min] = note?.min ?? null;
      copy[max] = note?.max ?? null;
    }
    return copy;
  });

  const detailColumns = Array.from(notedFields).flatMap(columnsOf);
  const expandedFields = fields?.flatMap((field) =>
    notedFields.has(field.name)
      ? [
          field,
          ...columnsOf(field.name).map((name) => ({
            id: name,
            name,
            selector: '',
            extractor: 'text' as const,
          })),
        ]
      : [field]
  );
  return { records: expanded, fields: expandedFields, detailColumns };
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
 * Generator producing NDJSON content in chunks to support very large datasets.
 * Each chunk is a string of newline-delimited JSON objects.
 */
export function* recordsToNdjsonChunks(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: JsonExportOptions = {}
): Generator<string> {
  if (records.length === 0) return;
  const allowedCols = resolveColumns(records, fields, options);
  const chunkSize = options.chunkSize || 1000;
  const lines: string[] = [];

  for (const r of records) {
    const cleaned: Record<string, unknown> = {};
    for (const key of allowedCols) {
      if (Object.prototype.hasOwnProperty.call(r, key)) {
        cleaned[key] = r[key];
      }
    }
    lines.push(JSON.stringify(cleaned));
    if (lines.length >= chunkSize) {
      yield lines.join('\n') + '\n';
      lines.length = 0;
    }
  }
  if (lines.length > 0) {
    yield lines.join('\n');
  }
}

/**
 * Generator producing JSON content in chunks to support very large datasets.
 * For pretty-printed JSON, chunks are emitted per-record with indentation.
 * For non-pretty, each chunk is a complete array segment.
 */
export function* recordsToJsonChunks(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: JsonExportOptions = { includeMetadata: false, pretty: true, format: 'json' }
): Generator<string> {
  if (records.length === 0) {
    yield '[]';
    return;
  }

  const allowedCols = resolveColumns(records, fields, options);
  const indent = options.pretty ? (options.indent ?? 2) : undefined;

  const cleanRecord = (r: ExtractedRecord): Record<string, unknown> => {
    const cleaned: Record<string, unknown> = {};
    for (const key of allowedCols) {
      if (Object.prototype.hasOwnProperty.call(r, key)) {
        cleaned[key] = r[key];
      }
    }
    return cleaned;
  };

  yield '[\n';
  const n = records.length;
  for (let i = 0; i < n; i++) {
    const cleaned = JSON.stringify(cleanRecord(records[i]), null, indent);
    // Indent each line of the record for pretty output
    const indented = options.pretty
      ? cleaned.split('\n').map((line) => ' '.repeat(options.indent ?? 2) + line).join('\n')
      : cleaned;
    yield indented + (i < n - 1 ? ',\n' : '');
  }
  yield '\n]';
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

  if (options.format === 'ndjson') {
    let out = '';
    for (const chunk of recordsToNdjsonChunks(records, fields, options)) {
      out += chunk;
    }
    return out;
  }

  let out = '';
  for (const chunk of recordsToJsonChunks(records, fields, { ...options, chunkSize: records.length })) {
    out += chunk;
  }
  return out;
}
