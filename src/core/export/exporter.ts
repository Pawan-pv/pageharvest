import { ExtractedRecord, FieldDefinition } from '@/types';

export interface CsvExportOptions {
  includeMetadata?: boolean; // If true, includes _id, _page, _extractedAt
  useBom?: boolean;          // Prepends \uFEFF for Excel UTF-8 compatibility
}

export interface JsonExportOptions {
  includeMetadata?: boolean;
  pretty?: boolean;
  format?: 'json' | 'ndjson';
}

/**
 * Escapes a string for RFC 4180 CSV compliance
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);
  // If cell contains commas, quotes, or newlines, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
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

  // Determine columns
  let columnNames: string[] = [];
  if (fields && fields.length > 0) {
    columnNames = fields.map((f) => f.name);
  } else {
    // Dynamic keys from records
    const keySet = new Set<string>();
    for (const r of records) {
      Object.keys(r).forEach((k) => keySet.add(k));
    }
    columnNames = Array.from(keySet);
  }

  if (!options.includeMetadata) {
    columnNames = columnNames.filter(
      (col) => !['_id', '_page', '_extractedAt', 'datasetId'].includes(col)
    );
  }

  const lines: string[] = [];

  // Header line
  lines.push(columnNames.map(escapeCsvCell).join(','));

  // Rows
  for (const record of records) {
    const row = columnNames.map((col) => escapeCsvCell(record[col]));
    lines.push(row.join(','));
  }

  const csvContent = lines.join('\r\n');
  return options.useBom ? `\uFEFF${csvContent}` : csvContent;
}

/**
 * Converts extracted records into formatted JSON or NDJSON.
 */
export function recordsToJson(
  records: ExtractedRecord[],
  fields?: FieldDefinition[],
  options: JsonExportOptions = { includeMetadata: false, pretty: true, format: 'json' }
): string {
  const allowedCols = fields ? fields.map((f) => f.name) : undefined;

  const cleanRecords = records.map((r) => {
    const cleaned: Record<string, unknown> = {};
    for (const key of Object.keys(r)) {
      if (!options.includeMetadata && ['_id', '_page', '_extractedAt', 'datasetId'].includes(key)) {
        continue;
      }
      if (allowedCols && !allowedCols.includes(key)) {
        continue;
      }
      cleaned[key] = r[key];
    }
    return cleaned;
  });

  if (options.format === 'ndjson') {
    return cleanRecords.map((r) => JSON.stringify(r)).join('\n');
  }

  return JSON.stringify(cleanRecords, null, options.pretty ? 2 : undefined);
}

/**
 * Triggers a file download in the browser or via Chrome Downloads API.
 */
export async function downloadExportFile(
  content: string,
  filename: string,
  mimeType: string
): Promise<void> {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });

  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    const blobUrl = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: blobUrl,
      filename,
      saveAs: true,
    });
    return;
  }

  // Fallback for standard browser context / tests
  if (typeof document !== 'undefined') {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
