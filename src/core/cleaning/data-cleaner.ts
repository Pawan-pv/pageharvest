import { ExtractedRecord, FieldDefinition } from '@/types';
import { isRecordMetadataKey } from '@/shared/contracts/record';
import { normalizeText, resolveAbsoluteUrl, parseNumberValue } from '@/utils/dom';

export interface CleaningOperationSnapshot {
  description: string;
  previousRecords: ExtractedRecord[];
  previousFields: FieldDefinition[];
  nextRecords: ExtractedRecord[];
  nextFields: FieldDefinition[];
  timestamp: number;
  isDestructive: boolean;
}

export type CleaningActionType =
  | 'REMOVE_DUPLICATES'
  | 'REMOVE_EMPTY_ROWS'
  | 'REMOVE_EMPTY_COLUMNS'
  | 'RENAME_COLUMN'
  | 'DELETE_COLUMNS'
  | 'REORDER_COLUMNS'
  | 'FIND_AND_REPLACE'
  | 'TRIM_WHITESPACE'
  | 'NORMALIZE_VALUES'
  | 'CUSTOM';

// See isRecordMetadataKey: provenance fields are not user data.

/**
 * Removes duplicate records. If keyFields is provided, equality is based only on those fields.
 * Otherwise, equality is based on all non-metadata fields.
 */
export function removeDuplicates(
  records: ExtractedRecord[],
  keyFields?: string[]
): {
  cleaned: ExtractedRecord[];
  duplicatesRemoved: number;
  removedRecords: ExtractedRecord[];
} {
  const seen = new Set<string>();
  const cleaned: ExtractedRecord[] = [];
  const removedRecords: ExtractedRecord[] = [];

  for (const record of records) {
    let key: string;

    if (keyFields && keyFields.length > 0) {
      key = keyFields
        .map((f) => `${f}:${String(record[f] ?? '')}`)
        .join('|');
    } else {
      const keys = Object.keys(record)
        .filter((k) => !isRecordMetadataKey(k))
        .sort();
      key = keys.map((k) => `${k}:${String(record[k] ?? '')}`).join('|');
    }

    if (seen.has(key)) {
      removedRecords.push(record);
    } else {
      seen.add(key);
      cleaned.push(record);
    }
  }

  return {
    cleaned,
    duplicatesRemoved: removedRecords.length,
    removedRecords,
  };
}

/**
 * Removes empty rows where all extracted data cells are empty string, whitespace, null, or undefined.
 */
export function removeEmptyRows(
  records: ExtractedRecord[],
  fields?: FieldDefinition[]
): {
  cleaned: ExtractedRecord[];
  emptyRowsRemoved: number;
  removedRecords: ExtractedRecord[];
} {
  const checkFields = fields ? fields.map((f) => f.name) : undefined;
  const cleaned: ExtractedRecord[] = [];
  const removedRecords: ExtractedRecord[] = [];

  for (const record of records) {
    const keysToCheck = checkFields || Object.keys(record).filter((k) => !isRecordMetadataKey(k));
    let hasData = false;

    for (const key of keysToCheck) {
      const val = record[key];
      if (val !== null && val !== undefined) {
        if (typeof val === 'string') {
          if (val.trim().length > 0) {
            hasData = true;
            break;
          }
        } else {
          // Number, boolean, or other value counts as data
          hasData = true;
          break;
        }
      }
    }

    if (hasData) {
      cleaned.push(record);
    } else {
      removedRecords.push(record);
    }
  }

  return {
    cleaned,
    emptyRowsRemoved: removedRecords.length,
    removedRecords,
  };
}

/**
 * Removes columns that have no values across any records.
 */
export function removeEmptyColumns(
  records: ExtractedRecord[],
  fields: FieldDefinition[]
): {
  cleanedRecords: ExtractedRecord[];
  remainingFields: FieldDefinition[];
  removedFields: FieldDefinition[];
} {
  const emptyColNames = new Set<string>();

  for (const field of fields) {
    let hasValue = false;
    for (const record of records) {
      const val = record[field.name];
      if (val !== null && val !== undefined) {
        if (typeof val === 'string') {
          if (val.trim().length > 0) {
            hasValue = true;
            break;
          }
        } else {
          hasValue = true;
          break;
        }
      }
    }

    if (!hasValue) {
      emptyColNames.add(field.name);
    }
  }

  const remainingFields = fields.filter((f) => !emptyColNames.has(f.name));
  const removedFields = fields.filter((f) => emptyColNames.has(f.name));

  const cleanedRecords = records.map((record) => {
    const copy = { ...record };
    for (const col of emptyColNames) {
      delete copy[col];
    }
    return copy;
  });

  return {
    cleanedRecords,
    remainingFields,
    removedFields,
  };
}

/**
 * Renames a column across field definitions and record keys.
 */
export function renameColumn(
  records: ExtractedRecord[],
  fields: FieldDefinition[],
  oldName: string,
  newName: string
): {
  records: ExtractedRecord[];
  fields: FieldDefinition[];
} {
  const trimmedNewName = newName.trim();
  if (!trimmedNewName) {
    throw new Error('New column name cannot be empty');
  }

  if (fields.some((f) => f.name.toLowerCase() === trimmedNewName.toLowerCase() && f.name !== oldName)) {
    throw new Error(`Column "${trimmedNewName}" already exists`);
  }

  const updatedFields = fields.map((f) => (f.name === oldName ? { ...f, name: trimmedNewName } : f));

  const updatedRecords = records.map((record) => {
    const copy = { ...record };
    if (Object.prototype.hasOwnProperty.call(copy, oldName)) {
      copy[trimmedNewName] = copy[oldName];
      delete copy[oldName];
    }
    return copy;
  });

  return {
    records: updatedRecords,
    fields: updatedFields,
  };
}

/**
 * Deletes specified columns from schema and records.
 */
export function deleteColumns(
  records: ExtractedRecord[],
  fields: FieldDefinition[],
  columnNames: string[]
): {
  records: ExtractedRecord[];
  fields: FieldDefinition[];
  removedFields: FieldDefinition[];
} {
  const colsToDelete = new Set(columnNames);

  const updatedFields = fields.filter((f) => !colsToDelete.has(f.name));
  const removedFields = fields.filter((f) => colsToDelete.has(f.name));

  const updatedRecords = records.map((record) => {
    const copy = { ...record };
    for (const col of colsToDelete) {
      delete copy[col];
    }
    return copy;
  });

  return {
    records: updatedRecords,
    fields: updatedFields,
    removedFields,
  };
}

/**
 * Reorders columns according to a specified array of field names.
 */
export function reorderColumns(
  fields: FieldDefinition[],
  newOrder: string[]
): FieldDefinition[] {
  const fieldMap = new Map(fields.map((f) => [f.name, f]));
  const reordered: FieldDefinition[] = [];

  for (const name of newOrder) {
    const field = fieldMap.get(name);
    if (field) {
      reordered.push(field);
      fieldMap.delete(name);
    }
  }

  // Append any fields that were not in newOrder
  for (const field of fieldMap.values()) {
    reordered.push(field);
  }

  return reordered;
}

/**
 * Finds and replaces occurrences in records.
 */
export function findAndReplace(
  records: ExtractedRecord[],
  options: {
    find: string;
    replace: string;
    column?: string;
    matchCase?: boolean;
    wholeWord?: boolean;
  }
): {
  records: ExtractedRecord[];
  replacementsCount: number;
} {
  if (!options.find) {
    return { records: [...records], replacementsCount: 0 };
  }

  const flags = options.matchCase ? 'g' : 'gi';
  const escapedFind = options.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = options.wholeWord ? `\\b${escapedFind}\\b` : escapedFind;
  const regex = new RegExp(pattern, flags);

  let replacementsCount = 0;

  const updatedRecords = records.map((record) => {
    const copy = { ...record };
    const cols = options.column ? [options.column] : Object.keys(copy).filter((k) => !isRecordMetadataKey(k));

    for (const col of cols) {
      const val = copy[col];
      if (typeof val === 'string') {
        const matches = val.match(regex);
        if (matches) {
          replacementsCount += matches.length;
          copy[col] = val.replace(regex, options.replace);
        }
      }
    }

    return copy;
  });

  return {
    records: updatedRecords,
    replacementsCount,
  };
}

/**
 * Trims leading/trailing whitespace and normalizes spaces for string cells.
 */
export function trimWhitespace(
  records: ExtractedRecord[],
  columns?: string[]
): {
  records: ExtractedRecord[];
  cellsModified: number;
} {
  let cellsModified = 0;

  const updatedRecords = records.map((record) => {
    const copy = { ...record };
    const cols = columns || Object.keys(copy).filter((k) => !isRecordMetadataKey(k));

    for (const col of cols) {
      const val = copy[col];
      if (typeof val === 'string') {
        const normalized = normalizeText(val);
        if (normalized !== val) {
          cellsModified++;
          copy[col] = normalized;
        }
      }
    }

    return copy;
  });

  return {
    records: updatedRecords,
    cellsModified,
  };
}

/**
 * Applies basic value normalization: numbers, URLs, casing, booleans.
 */
export function normalizeValues(
  records: ExtractedRecord[],
  column: string,
  normalizationType: 'number' | 'url' | 'lowercase' | 'uppercase' | 'titlecase' | 'boolean',
  baseUrl?: string
): {
  records: ExtractedRecord[];
  cellsModified: number;
} {
  let cellsModified = 0;

  const updatedRecords = records.map((record) => {
    const copy = { ...record };
    const val = copy[column];
    let newVal: string | number | boolean | null | undefined = val;

    switch (normalizationType) {
      case 'number':
        if (typeof val === 'string') {
          // A value that is not certainly one number stays as it is, rather than being lost.
          newVal = parseNumberValue(val) ?? val;
        }
        break;

      case 'url':
        if (typeof val === 'string') {
          newVal = resolveAbsoluteUrl(val, baseUrl);
        }
        break;

      case 'uppercase':
        if (typeof val === 'string') {
          newVal = val.toUpperCase();
        }
        break;

      case 'lowercase':
        if (typeof val === 'string') {
          newVal = val.toLowerCase();
        }
        break;

      case 'titlecase':
        if (typeof val === 'string') {
          newVal = val.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
        }
        break;

      case 'boolean':
        if (typeof val === 'string') {
          const lower = val.trim().toLowerCase();
          if (['true', 'yes', '1', 'y', 'in stock'].includes(lower)) {
            newVal = true;
          } else if (['false', 'no', '0', 'n', 'out of stock'].includes(lower)) {
            newVal = false;
          }
        }
        break;
    }

    if (newVal !== val) {
      cellsModified++;
      copy[column] = newVal;
    }

    return copy;
  });

  return {
    records: updatedRecords,
    cellsModified,
  };
}

/**
 * Undo / Redo History Manager for reversible data cleaning operations.
 */
/** Default maximum number of undo snapshots retained in memory. */
export const DEFAULT_HISTORY_CAP = 20;
/** Reduced history cap when the dataset is large, to bound memory usage. */
export const LARGE_DATASET_HISTORY_CAP = 5;
/** Record count above which the reduced history cap applies. */
export const LARGE_DATASET_RECORD_THRESHOLD = 5000;

/**
 * Undo / Redo History Manager for reversible data cleaning operations.
 *
 * The undo stack is capped to prevent unbounded memory growth in the Side Panel.
 * When the dataset exceeds LARGE_DATASET_RECORD_THRESHOLD rows, a smaller cap
 * applies. The oldest snapshot is evicted (undoStack.shift()) when the cap is
 * exceeded. The cap is checked both at construction and on every recordOperation
 * so that datasets that grow past the threshold mid-session are handled too.
 */
export class DataCleaningHistory {
  private undoStack: CleaningOperationSnapshot[] = [];
  private redoStack: CleaningOperationSnapshot[] = [];
  public currentRecords: ExtractedRecord[];
  public currentFields: FieldDefinition[];
  private historyCap: number;
  private readonly explicitCap: boolean;

  constructor(
    initialRecords: ExtractedRecord[],
    initialFields: FieldDefinition[],
    historyCap?: number
  ) {
    this.currentRecords = [...initialRecords];
    this.currentFields = [...initialFields];
    this.explicitCap = historyCap !== undefined;
    // Dynamically lower the cap for large datasets to bound memory.
    this.historyCap = historyCap ?? this.computeCap(initialRecords.length);
  }

  /** Computes the effective cap for a given record count. */
  private computeCap(recordCount: number): number {
    return recordCount > LARGE_DATASET_RECORD_THRESHOLD
      ? LARGE_DATASET_HISTORY_CAP
      : DEFAULT_HISTORY_CAP;
  }

  /** Re-evaluates the cap based on current record count and trims the stack if needed. */
  private maybeAdjustCap(recordCount: number): void {
    if (!this.explicitCap) {
      const newCap = this.computeCap(recordCount);
      if (newCap !== this.historyCap) {
        this.historyCap = newCap;
      }
    }
    while (this.undoStack.length > this.historyCap) {
      this.undoStack.shift();
    }
  }

  public recordOperation(operation: {
    description: string;
    previousRecords: ExtractedRecord[];
    previousFields: FieldDefinition[];
    nextRecords: ExtractedRecord[];
    nextFields: FieldDefinition[];
    isDestructive?: boolean;
  }): void {
    const snapshot: CleaningOperationSnapshot = {
      description: operation.description,
      previousRecords: [...operation.previousRecords],
      previousFields: [...operation.previousFields],
      nextRecords: [...operation.nextRecords],
      nextFields: [...operation.nextFields],
      timestamp: Date.now(),
      isDestructive: operation.isDestructive ?? false,
    };

    this.undoStack.push(snapshot);
    // Dynamically re-check the cap against the records being written. If no
    // explicit cap was provided, lower it for large datasets and evict oldest
    // snapshots as needed.
    this.maybeAdjustCap(operation.nextRecords.length);
    this.redoStack = []; // Clears redo on new action
    this.currentRecords = [...operation.nextRecords];
    this.currentFields = [...operation.nextFields];
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;

    this.redoStack.push(snapshot);
    this.currentRecords = [...snapshot.previousRecords];
    this.currentFields = [...snapshot.previousFields];
    return true;
  }

  public redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;

    this.undoStack.push(snapshot);
    this.currentRecords = [...snapshot.nextRecords];
    this.currentFields = [...snapshot.nextFields];
    return true;
  }

  public isOperationDestructive(action: CleaningActionType): boolean {
    return ['DELETE_COLUMNS', 'REMOVE_DUPLICATES', 'REMOVE_EMPTY_ROWS'].includes(action);
  }

  public getUndoHistory(): CleaningOperationSnapshot[] {
    return [...this.undoStack];
  }
}
