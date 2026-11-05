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

// ---------------------------------------------------------------------------
// XLSX export (Office Open XML, written as a stored (uncompressed) ZIP)
// ---------------------------------------------------------------------------

function escapeXml(value: unknown): string {
  return String(value)
    // Strip invalid XML 1.0 control characters before escaping entities.
    // eslint-disable-next-line no-control-regex -- control chars intentionally stripped
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnLetter(index: number): string {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function sanitizeSheetName(name: string | undefined): string {
  const base = (name ?? 'Sheet1').trim() || 'Sheet1';
  // Excel forbids: \ / ? * [ ] and limits to 31 chars.
  const cleaned = base.replace(/[\\/?*[\]]/g, ' ').slice(0, 31).trim();
  return cleaned || 'Sheet1';
}

function buildWorksheetXml(
  records: ExtractedRecord[],
  columns: string[]
): string {
  const rows: string[] = [];
  // Header row
  const headerCells = columns
    .map((col, ci) => {
      const ref = `${columnLetter(ci)}1`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(col)}</t></is></c>`;
    })
    .join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  records.forEach((record, ri) => {
    const rowNum = ri + 2;
    const cells = columns
      .map((col, ci) => {
        const ref = `${columnLetter(ci)}${rowNum}`;
        const value = record[col];
        if (value === null || value === undefined) {
          return `<c r="${ref}"/>`;
        }
        if (typeof value === 'boolean') {
          return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          return `<c r="${ref}"><v>${value}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
      })
      .join('');
    rows.push(`<row r="${rowNum}">${cells}</row>`);
  });

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>'
  );
}

// ---- Minimal synchronous ZIP writer (stored entries) ----

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

function strToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function createStoredZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  let offset = 0;
  const cdEntries: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const nameBytes = strToBytes(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20); // version needed
    writeUint16(localHeader, 6, 0x0800); // UTF-8 flag
    writeUint16(localHeader, 8, 0); // stored
    writeUint16(localHeader, 10, 0); // mod time
    writeUint16(localHeader, 12, 0); // mod date
    writeUint32(localHeader, 14, crc);
    writeUint32(localHeader, 18, size);
    writeUint32(localHeader, 22, size);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0); // extra length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader);
    localParts.push(data);

    cdEntries.push({ name: nameBytes, crc, size, offset });
    offset += localHeader.length + data.length;
  }

  // Central directory
  let cdSize = 0;
  const cdBuffers: Uint8Array[] = [];
  for (let i = 0; i < entries.length; i++) {
    const cdEntry = cdEntries[i];
    const nameBytes = cdEntry.name;
    const header = new Uint8Array(46 + nameBytes.length);
    writeUint32(header, 0, 0x02014b50);
    writeUint16(header, 4, 20); // version made by
    writeUint16(header, 6, 20); // version needed
    writeUint16(header, 8, 0x0800); // flags
    writeUint16(header, 10, 0); // method
    writeUint16(header, 12, 0); // mod time
    writeUint16(header, 14, 0); // mod date
    writeUint32(header, 16, cdEntry.crc);
    writeUint32(header, 20, cdEntry.size);
    writeUint32(header, 24, cdEntry.size);
    writeUint16(header, 28, nameBytes.length);
    writeUint16(header, 30, 0); // extra
    writeUint16(header, 32, 0); // comment
    writeUint16(header, 34, 0); // disk number
    writeUint16(header, 36, 0); // internal attr
    writeUint32(header, 38, 0); // external attr
    writeUint32(header, 42, cdEntry.offset);
    header.set(nameBytes, 46);
    cdBuffers.push(header);
    cdSize += header.length;
  }

  const cdOffset = offset;
  // End of central directory
  const eocd = new Uint8Array(22);
  writeUint32(eocd, 0, 0x06054b50);
  writeUint16(eocd, 4, 0); // disk number
  writeUint16(eocd, 6, 0); // disk with cd
  writeUint16(eocd, 8, entries.length);
  writeUint16(eocd, 10, entries.length);
  writeUint32(eocd, 12, cdSize);
  writeUint32(eocd, 16, cdOffset);
  writeUint16(eocd, 20, 0); // comment length

  // Assemble
  const totalSize =
    localParts.reduce((s, b) => s + b.length, 0) +
    cdBuffers.reduce((s, b) => s + b.length, 0) +
    eocd.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const b of localParts) {
    out.set(b, pos);
    pos += b.length;
  }
  for (const b of cdBuffers) {
    out.set(b, pos);
    pos += b.length;
  }
  out.set(eocd, pos);
  return out;
}

export function recordsToXlsx(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: XlsxExportOptions = {}
): Uint8Array {
  const columns = resolveColumns(records, fields, options);
  const sheetName = sanitizeSheetName(options.sheetName);
  const worksheetXml = buildWorksheetXml(
    records.length ? records : [],
    columns
  );

  // If no records, still emit header? resolveColumns may be empty; build empty sheet.
  // Ensure at least columns from fields? resolveColumns handles.

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: strToBytes(contentTypes) },
    { name: '_rels/.rels', data: strToBytes(rootRels) },
    { name: 'xl/workbook.xml', data: strToBytes(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: strToBytes(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: strToBytes(worksheetXml) },
  ];

  return createStoredZip(entries);
}

export function recordsToXlsxBuffer(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: XlsxExportOptions = {}
): ArrayBuffer {
  const bytes = recordsToXlsx(records, fields, options);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function recordsToXlsxBlob(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: XlsxExportOptions = {}
): Blob {
  const bytes = recordsToXlsx(records, fields, options);
  return new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Back-compat / convenience aliases
export const exportToXlsx = recordsToXlsx;
export const recordsToExcel = recordsToXlsx;
