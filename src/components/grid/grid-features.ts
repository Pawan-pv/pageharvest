import {
  removeDuplicates,
  removeEmptyColumns,
  removeEmptyRows,
  trimWhitespace,
} from '@/core/cleaning/data-cleaner';
import { isRecordMetadataKey } from '@/shared/contracts/record';
import type { ExtractedRecord, FieldDefinition } from '@/types';

/**
 * Pure spreadsheet operations behind the Data Table 2.0 toolbar. Keeping them here, away
 * from React, means the merge, clean and column-detection rules are unit-tested directly.
 */

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'ico',
]);

export function isImageUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase().startsWith('data:image/')) return true;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const lastSegment = parsed.pathname.split('/').pop() ?? '';
  const extension = lastSegment.includes('.') ? lastSegment.split('.').pop()?.toLowerCase() : undefined;
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension);
}

export function isWebUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function nonEmptyValues(records: ExtractedRecord[], column: string): unknown[] {
  const values: unknown[] = [];
  for (const record of records) {
    const value = record[column];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    values.push(value);
  }
  return values;
}

export type ColumnKind = 'image' | 'url' | 'text';

/**
 * A column is an image or URL column when most of its filled cells are image / web
 * addresses. A majority, not every cell: a stray "n/a" must not hide a gallery.
 */
export function detectColumnKind(records: ExtractedRecord[], column: string): ColumnKind {
  const values = nonEmptyValues(records, column);
  if (values.length === 0) return 'text';
  const images = values.filter(isImageUrl).length;
  if (images > 0 && images * 2 >= values.length) return 'image';
  const urls = values.filter(isWebUrl).length;
  if (urls > 0 && urls * 2 >= values.length) return 'url';
  return 'text';
}

export function detectImageColumns(records: ExtractedRecord[], fields: FieldDefinition[]): string[] {
  return fields.map((field) => field.name).filter((name) => detectColumnKind(records, name) === 'image');
}

export function detectUrlColumns(records: ExtractedRecord[], fields: FieldDefinition[]): string[] {
  return fields.map((field) => field.name).filter((name) => detectColumnKind(records, name) === 'url');
}

/** Every filled value of a column, in row order. The caller de-duplicates and validates. */
export function columnValues(records: ExtractedRecord[], column: string): string[] {
  return records
    .map((record) => record[column])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

// ---------------------------------------------------------------------------
// Merge columns
// ---------------------------------------------------------------------------

export interface MergeColumnsOptions {
  columns: string[];
  delimiter: string;
  newName: string;
  /** When true the merged columns are removed, leaving only the new one. */
  dropSources: boolean;
}

export interface MergeColumnsResult {
  records: ExtractedRecord[];
  fields: FieldDefinition[];
}

function mergedValue(record: ExtractedRecord, columns: string[], delimiter: string): string {
  return columns
    .map((column) => record[column])
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .map((value) => String(value).trim())
    .join(delimiter);
}

/**
 * Joins two or more columns into one with a delimiter. The new column sits where the first
 * merged column was, so the spreadsheet keeps the order the user arranged.
 */
export function mergeColumns(
  records: ExtractedRecord[],
  fields: FieldDefinition[],
  options: MergeColumnsOptions
): MergeColumnsResult {
  const columns = [...new Set(options.columns.map((name) => name.trim()).filter(Boolean))];
  if (columns.length < 2) {
    throw new Error('Choose at least two columns to merge.');
  }
  const newName = options.newName.trim();
  if (!newName) {
    throw new Error('Give the merged column a name.');
  }

  const fieldNames = new Set(fields.map((field) => field.name));
  for (const column of columns) {
    if (!fieldNames.has(column)) {
      throw new Error(`The column "${column}" is no longer in this table.`);
    }
  }
  const collision = fieldNames.has(newName) && !columns.includes(newName);
  if (collision) {
    throw new Error(`There is already a column named "${newName}".`);
  }

  const delimiter = options.delimiter;
  const mergedRecords = records.map((record) => {
    const copy = { ...record, [newName]: mergedValue(record, columns, delimiter) };
    if (options.dropSources) {
      for (const column of columns) {
        if (column !== newName) delete copy[column];
      }
    }
    return copy;
  });

  const firstIndex = fields.findIndex((field) => field.name === columns[0]);
  const mergedField: FieldDefinition = {
    id: fields[firstIndex]?.id ?? `merged_${newName.replace(/\s+/g, '_').toLowerCase()}`,
    name: newName,
    selector: '',
    extractor: 'text',
  };

  let mergedFields: FieldDefinition[];
  if (options.dropSources) {
    const sources = new Set(columns);
    mergedFields = fields
      .filter((field) => !sources.has(field.name) || field.name === columns[0])
      .map((field) => (field.name === columns[0] ? mergedField : field));
  } else {
    mergedFields = [...fields];
    let insertAt = 0;
    for (let index = 0; index < fields.length; index += 1) {
      if (columns.includes(fields[index].name)) insertAt = index + 1;
    }
    mergedFields.splice(insertAt, 0, mergedField);
  }

  return { records: mergedRecords, fields: mergedFields };
}

// ---------------------------------------------------------------------------
// One-click smart clean
// ---------------------------------------------------------------------------

export interface SmartCleanSummary {
  trimmedCells: number;
  emptyRowsRemoved: number;
  duplicatesRemoved: number;
  emptyColumnsRemoved: number;
}

export interface SmartCleanResult {
  records: ExtractedRecord[];
  fields: FieldDefinition[];
  summary: SmartCleanSummary;
}

/**
 * The one-click tidy-up: trim whitespace, drop rows with nothing in them, drop rows that
 * repeat an earlier row, then drop columns that ended up empty. Each step reports its own
 * count so the toast can say exactly what changed.
 */
export function smartClean(
  records: ExtractedRecord[],
  fields: FieldDefinition[]
): SmartCleanResult {
  const trimmed = trimWhitespace(records);
  const withoutEmptyRows = removeEmptyRows(trimmed.records, fields);
  const withoutDuplicates = removeDuplicates(withoutEmptyRows.cleaned);
  const withoutEmptyColumns = removeEmptyColumns(withoutDuplicates.cleaned, fields);

  return {
    records: withoutEmptyColumns.cleanedRecords,
    fields: withoutEmptyColumns.remainingFields,
    summary: {
      trimmedCells: trimmed.cellsModified,
      emptyRowsRemoved: withoutEmptyRows.emptyRowsRemoved,
      duplicatesRemoved: withoutDuplicates.duplicatesRemoved,
      emptyColumnsRemoved: withoutEmptyColumns.removedFields.length,
    },
  };
}

export function describeSmartClean(summary: SmartCleanSummary): string {
  const parts: string[] = [];
  if (summary.trimmedCells > 0) parts.push(`trimmed ${summary.trimmedCells} cell${summary.trimmedCells === 1 ? '' : 's'}`);
  if (summary.emptyRowsRemoved > 0) parts.push(`removed ${summary.emptyRowsRemoved} empty row${summary.emptyRowsRemoved === 1 ? '' : 's'}`);
  if (summary.duplicatesRemoved > 0) parts.push(`removed ${summary.duplicatesRemoved} duplicate${summary.duplicatesRemoved === 1 ? '' : 's'}`);
  if (summary.emptyColumnsRemoved > 0) parts.push(`removed ${summary.emptyColumnsRemoved} empty column${summary.emptyColumnsRemoved === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'Everything is already tidy. Nothing needed changing.';
  return `Smart Clean: ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Row identity helper for merge / clean previews
// ---------------------------------------------------------------------------

/** Field names in display order, with metadata keys left out. */
export function dataColumnNames(records: ExtractedRecord[], fields: FieldDefinition[]): string[] {
  if (fields.length > 0) return fields.map((field) => field.name);
  const sample = records[0] ?? {};
  return Object.keys(sample).filter((key) => !isRecordMetadataKey(key));
}
