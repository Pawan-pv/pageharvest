import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  SortingState,
  ColumnOrderState,
  RowSelectionState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import {
  FileSpreadsheet,
  Copy,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  PlusCircle,
  ExternalLink,
  ChevronLeftSquare,
  ChevronRightSquare,
  Edit2,
  Download,
  AlertCircle,
  RefreshCw,
  Loader2,
  Filter,
} from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { isRecordMetadataKey } from '@/shared/contracts/record';
import { ExtractedRecord, FieldDefinition, Dataset } from '@/types';
import {
  recordsToCsv,
} from '@/core/export/exporter';
import {
  removeDuplicates,
  removeEmptyRows,
  removeEmptyColumns,
  renameColumn,
  deleteColumns,
  reorderColumns,
  findAndReplace,
  trimWhitespace,
  normalizeValues,
  DataCleaningHistory,
} from '@/core/cleaning/data-cleaner';
import { DataCleaningToolbar } from './DataCleaningToolbar';
import { ExportDialog } from './ExportDialog';

export interface DataTableProps {
  dataset?: Dataset | null;
  records: ExtractedRecord[];
  fields: FieldDefinition[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** These may return a promise. A rejection undoes the change on screen and shows why. */
  onUpdateCell?: (recordId: string, fieldName: string, value: string | number | null) => void | Promise<void>;
  onDeleteRecord?: (recordId: string) => void | Promise<void>;
  onDeleteRecordsBatch?: (recordIds: string[]) => void;
  onRecordsChange?: (records: ExtractedRecord[], fields?: FieldDefinition[]) => void | Promise<void>;
  onNewExtraction?: () => void;
  /**
   * Changes only when a different set of rows has been loaded. Once this is provided, the
   * grid owns its working copy: edits made here do not reset the grid or its undo history.
   */
  dataRevision?: number;
  /** What happened to the detected items in the run that produced this dataset. */
  runSummary?: {
    recordsDetected: number;
    totalExtracted: number;
    recordsWithMissingFields: number;
    recordsFiltered: number;
    recordsFailed: number;
    duplicatesSkipped: number;
  } | null;
}

const EditableCellInput: React.FC<{
  initialValue: string;
  onSave: (val: string) => void;
  onCancel: () => void;
}> = ({ initialValue, onSave, onCancel }) => {
  const [val, setVal] = useState(initialValue);
  return (
    <input
      type="text"
      autoFocus
      className="w-full px-1.5 py-0.5 text-xs border border-brand rounded bg-surface shadow-xs focus:outline-none"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onSave(val)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onSave(val);
        } else if (e.key === 'Escape') {
          onCancel();
        }
      }}
    />
  );
};

export const DataTable: React.FC<DataTableProps> = ({
  dataset,
  records: initialRecords,
  fields: initialFields,
  isLoading = false,
  error = null,
  onRetry,
  onUpdateCell,
  onDeleteRecord,
  onDeleteRecordsBatch,
  onRecordsChange,
  onNewExtraction,
  dataRevision,
  runSummary,
}) => {
  // Local active dataset state backed by DataCleaningHistory for full reversibility
  const [currentRecords, setCurrentRecords] = useState<ExtractedRecord[]>(initialRecords);
  const [currentFields, setCurrentFields] = useState<FieldDefinition[]>(initialFields);
  const [cleaningHistory, setCleaningHistory] = useState<DataCleaningHistory>(
    () => new DataCleaningHistory(initialRecords, initialFields)
  );
  const [gridError, setGridError] = useState<string | null>(null);

  // Take a new copy of the rows only when different rows have been loaded.
  const latestInitial = useRef({ initialRecords, initialFields });
  latestInitial.current = { initialRecords, initialFields };
  const recordsKey = dataRevision ?? initialRecords;
  const fieldsKey = dataRevision ?? initialFields;
  const loadedKeys = useRef({ recordsKey, fieldsKey });
  useEffect(() => {
    // The initial state above already holds the first set of rows.
    if (loadedKeys.current.recordsKey === recordsKey && loadedKeys.current.fieldsKey === fieldsKey) {
      return;
    }
    loadedKeys.current = { recordsKey, fieldsKey };
    const { initialRecords: rows, initialFields: columns } = latestInitial.current;
    setCurrentRecords(rows);
    setCurrentFields(columns);
    setCleaningHistory(new DataCleaningHistory(rows, columns));
  }, [recordsKey, fieldsKey]);

  // Table interactive states
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showColMenu, setShowColMenu] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [cleaningFeedback, setCleaningFeedback] = useState<string | null>(null);

  // Editing state
  const [editingCell, setEditingCell] = useState<{ recordId: string; columnId: string } | null>(null);
  const [, setEditValue] = useState<string>('');

  // Column renaming modal state
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [newColName, setNewColName] = useState('');

  // Auto-clear feedback toast
  const triggerFeedback = useCallback((msg: string) => {
    setCleaningFeedback(msg);
    setTimeout(() => setCleaningFeedback(null), 3000);
  }, []);

  // Derive visible fields
  const visibleFields = useMemo(() => {
    if (currentFields && currentFields.length > 0) return currentFields;
    const sample = currentRecords[0] || {};
    return Object.keys(sample)
      .filter((k) => !isRecordMetadataKey(k))
      .map((k) => ({
        id: k,
        name: k,
        selector: '',
        extractor: 'text' as const,
      }));
  }, [currentFields, currentRecords]);

  /**
   * Saves a change that is already showing in the grid. Success is only announced once
   * the save has completed; a failed save takes the change back off the screen.
   */
  const persistChange = useCallback((
    records: ExtractedRecord[],
    fields: FieldDefinition[],
    rollback: () => void,
    successMessage?: string
  ) => {
    if (!onRecordsChange) {
      if (successMessage) triggerFeedback(successMessage);
      return;
    }
    void Promise.resolve()
      .then(() => onRecordsChange(records, fields))
      .then(
        () => {
          setGridError(null);
          if (successMessage) triggerFeedback(successMessage);
        },
        (error: unknown) => {
          setGridError(`Your change was not saved: ${error instanceof Error ? error.message : String(error)}`);
          rollback();
        }
      );
  }, [onRecordsChange, triggerFeedback]);

  const showHistoryState = useCallback(() => {
    setCurrentRecords([...cleaningHistory.currentRecords]);
    setCurrentFields([...cleaningHistory.currentFields]);
  }, [cleaningHistory]);

  // Apply new records state with history tracking and parent callback
  const commitCleaningState = useCallback((
    description: string,
    nextRecords: ExtractedRecord[],
    nextFields: FieldDefinition[] = currentFields,
    isDestructive: boolean = false,
    successMessage?: string
  ) => {
    cleaningHistory.recordOperation({
      description,
      previousRecords: currentRecords,
      previousFields: currentFields,
      nextRecords,
      nextFields,
      isDestructive,
    });
    setCurrentRecords(nextRecords);
    setCurrentFields(nextFields);
    setRowSelection({});
    persistChange(nextRecords, nextFields, () => {
      cleaningHistory.undo();
      showHistoryState();
    }, successMessage);
  }, [cleaningHistory, currentFields, currentRecords, persistChange, showHistoryState]);

  // Data Cleaning actions
  const handleUndo = () => {
    if (!cleaningHistory.canUndo()) return;
    cleaningHistory.undo();
    showHistoryState();
    persistChange(cleaningHistory.currentRecords, cleaningHistory.currentFields, () => {
      cleaningHistory.redo();
      showHistoryState();
    }, 'Undone last action');
  };

  const handleRedo = () => {
    if (!cleaningHistory.canRedo()) return;
    cleaningHistory.redo();
    showHistoryState();
    persistChange(cleaningHistory.currentRecords, cleaningHistory.currentFields, () => {
      cleaningHistory.undo();
      showHistoryState();
    }, 'Redone action');
  };

  /** Rows and cells are saved individually, but stay in the same undo history. */
  const applyRowChange = useCallback((
    description: string,
    nextRecords: ExtractedRecord[],
    save: () => void | Promise<void>
  ) => {
    cleaningHistory.recordOperation({
      description,
      previousRecords: currentRecords,
      previousFields: currentFields,
      nextRecords,
      nextFields: currentFields,
    });
    setCurrentRecords(nextRecords);
    void Promise.resolve(save()).catch((error: unknown) => {
      setGridError(`Your change was not saved: ${error instanceof Error ? error.message : String(error)}`);
      cleaningHistory.undo();
      showHistoryState();
    });
  }, [cleaningHistory, currentFields, currentRecords, showHistoryState]);

  const handleCellSave = useCallback((recordId: string, columnId: string, value: string) => {
    setEditingCell(null);
    applyRowChange(
      `Edit ${columnId}`,
      currentRecords.map((r) => (r._id === recordId ? { ...r, [columnId]: value } : r)),
      () => onUpdateCell?.(recordId, columnId, value)
    );
  }, [applyRowChange, currentRecords, onUpdateCell]);

  const handleDeleteRow = useCallback((recordId: string) => {
    applyRowChange(
      'Delete row',
      currentRecords.filter((r) => r._id !== recordId),
      () => onDeleteRecord?.(recordId)
    );
  }, [applyRowChange, currentRecords, onDeleteRecord]);

  const handleRemoveDuplicates = () => {
    const { cleaned, duplicatesRemoved } = removeDuplicates(currentRecords);
    commitCleaningState('Remove Duplicates', cleaned, currentFields, false, `Removed ${duplicatesRemoved} duplicate row(s)`);
  };

  const handleRemoveEmptyRows = () => {
    const { cleaned, emptyRowsRemoved } = removeEmptyRows(currentRecords, currentFields);
    commitCleaningState('Remove Empty Rows', cleaned, currentFields, false, `Removed ${emptyRowsRemoved} empty row(s)`);
  };

  const handleRemoveEmptyColumns = () => {
    const { cleanedRecords, remainingFields, removedFields } = removeEmptyColumns(currentRecords, currentFields);
    commitCleaningState('Remove Empty Columns', cleanedRecords, remainingFields, false, `Removed ${removedFields.length} empty column(s)`);
  };

  const handleTrimWhitespace = () => {
    const { records: updated, cellsModified } = trimWhitespace(currentRecords);
    commitCleaningState('Trim Whitespace', updated, currentFields, false, `Trimmed whitespace across ${cellsModified} cell(s)`);
  };

  const handleFindAndReplace = (options: {
    find: string;
    replace: string;
    column?: string;
    matchCase: boolean;
  }) => {
    const { records: updated, replacementsCount } = findAndReplace(currentRecords, options);
    commitCleaningState('Find & Replace', updated, currentFields, false, `Replaced ${replacementsCount} occurrence(s)`);
  };

  const handleNormalizeValues = (
    column: string,
    type: 'number' | 'url' | 'lowercase' | 'uppercase' | 'titlecase' | 'boolean'
  ) => {
    const { records: updated, cellsModified } = normalizeValues(currentRecords, column, type, dataset?.url);
    commitCleaningState(`Normalize ${column}`, updated, currentFields, false, `Normalized ${cellsModified} cell(s) in ${column}`);
  };

  const handleMoveColumn = useCallback((columnId: string, direction: 'left' | 'right') => {
    const currentOrder = columnOrder.length > 0
      ? [...columnOrder]
      : ['__select', ...visibleFields.map((f) => f.name), '__actions'];

    const index = currentOrder.indexOf(columnId);
    if (index === -1) return;

    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    // Don't move past checkbox column (__select) or actions column (__actions)
    if (targetIndex <= 0 || targetIndex >= currentOrder.length - 1) return;

    const temp = currentOrder[index];
    currentOrder[index] = currentOrder[targetIndex];
    currentOrder[targetIndex] = temp;

    setColumnOrder(currentOrder);

    // Also update field definitions order
    const orderedFieldNames = currentOrder.filter((c) => c !== '__select' && c !== '__actions');
    const reordered = reorderColumns(currentFields, orderedFieldNames);
    const previousFields = currentFields;
    const previousOrder = columnOrder;
    setCurrentFields(reordered);
    persistChange(currentRecords, reordered, () => {
      setCurrentFields(previousFields);
      setColumnOrder(previousOrder);
    });
  }, [columnOrder, currentFields, currentRecords, persistChange, visibleFields]);

  const handleRenameColumnSubmit = () => {
    if (!renamingCol || !newColName.trim()) return;
    try {
      const { records: updatedRecords, fields: updatedFields } = renameColumn(
        currentRecords,
        currentFields,
        renamingCol,
        newColName.trim()
      );
      commitCleaningState(
        `Rename ${renamingCol} to ${newColName.trim()}`,
        updatedRecords,
        updatedFields,
        false,
        `Renamed column to ${newColName.trim()}`
      );
      setRenamingCol(null);
      setNewColName('');
    } catch (err: unknown) {
      setGridError((err as Error).message);
    }
  };

  const handleDeleteColumn = useCallback((columnName: string) => {
    if (!confirm(`Are you sure you want to permanently delete column "${columnName}"?`)) return;
    const { records: updatedRecords, fields: updatedFields } = deleteColumns(
      currentRecords,
      currentFields,
      [columnName]
    );
    commitCleaningState(`Delete Column ${columnName}`, updatedRecords, updatedFields, true, `Deleted column "${columnName}"`);
  }, [commitCleaningState, currentFields, currentRecords]);

  const handleDeleteSelectedRows = () => {
    const selectedIndices = Object.keys(rowSelection).map(Number);
    if (selectedIndices.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedIndices.length} selected row(s)?`)) return;

    const selectedIds = selectedIndices.map((idx) => currentRecords[idx]._id);
    const remaining = currentRecords.filter((_, idx) => !rowSelection[idx]);

    if (onDeleteRecordsBatch) {
      onDeleteRecordsBatch(selectedIds);
    }

    commitCleaningState(
      `Delete ${selectedIndices.length} row(s)`,
      remaining,
      currentFields,
      true,
      `Deleted ${selectedIndices.length} row(s)`
    );
  };

  // Define TanStack Table Columns
  const columns = useMemo<ColumnDef<ExtractedRecord>[]>(() => {
    const cols: ColumnDef<ExtractedRecord>[] = [];

    // 1. Checkbox Select Column
    cols.push({
      id: '__select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          aria-label="Select all rows on page"
          className="w-3.5 h-3.5 rounded text-brand-fg border-line-strong focus:ring-focus cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
          aria-label="Select row"
          className="w-3.5 h-3.5 rounded text-brand-fg border-line-strong focus:ring-focus cursor-pointer"
        />
      ),
      size: 32,
      enableResizing: false,
      enableSorting: false,
    });

    // 2. Data Columns
    for (const field of visibleFields) {
      cols.push({
        id: field.name,
        accessorKey: field.name,
        sortDescFirst: false,
        header: () => (
          <div className="flex items-center justify-between gap-1 w-full group/hdr">
            <span className="truncate">{field.name}</span>
            <div className="flex items-center opacity-0 group-hover/hdr:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoveColumn(field.name, 'left');
                }}
                title="Move column left"
                className="p-0.5 text-fg-subtle hover:text-fg-muted rounded"
              >
                <ChevronLeftSquare className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoveColumn(field.name, 'right');
                }}
                title="Move column right"
                className="p-0.5 text-fg-subtle hover:text-fg-muted rounded"
              >
                <ChevronRightSquare className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingCol(field.name);
                  setNewColName(field.name);
                }}
                title="Rename column"
                className="p-0.5 text-fg-subtle hover:text-fg-muted rounded"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteColumn(field.name);
                }}
                title="Delete column"
                className="p-0.5 text-fg-subtle hover:text-danger-fg rounded"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ),
        cell: ({ row, getValue }) => {
          const value = getValue();
          const recordId = row.original._id;
          const isEditing = editingCell?.recordId === recordId && editingCell?.columnId === field.name;

          const strVal = value !== null && value !== undefined ? String(value) : '';
          const isUrl = strVal.startsWith('http://') || strVal.startsWith('https://');

          if (isEditing) {
            return (
              <EditableCellInput
                initialValue={strVal}
                onSave={(newVal) => handleCellSave(recordId, field.name, newVal)}
                onCancel={() => setEditingCell(null)}
              />
            );
          }

          return (
            <div
              onDoubleClick={() => {
                setEditingCell({ recordId, columnId: field.name });
                setEditValue(strVal);
              }}
              className="flex items-center justify-between gap-1 w-full truncate py-0.5 cursor-text text-left select-text"
              title="Double click to edit cell"
            >
              {isUrl ? (
                <a
                  href={strVal}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-fg hover:underline truncate inline-flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="truncate">{strVal}</span>
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                </a>
              ) : (
                <span className="truncate text-fg">
                  {strVal || <span className="text-fg-faint italic">empty</span>}
                </span>
              )}
            </div>
          );
        },
      });
    }

    // 3. Row action column
    cols.push({
      id: '__actions',
      header: '',
      size: 40,
      enableResizing: false,
      enableSorting: false,
      cell: ({ row }) => (
        <button
          onClick={() => handleDeleteRow(row.original._id)}
          aria-label="Delete row"
          title="Delete row"
          className="p-1 text-fg-faint hover:text-danger-fg rounded transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    });

    return cols;
  }, [visibleFields, editingCell, handleCellSave, handleDeleteRow, handleDeleteColumn, handleMoveColumn]);

  const table = useReactTable({
    data: currentRecords,
    columns,
    state: {
      globalFilter,
      sorting,
      columnVisibility,
      columnOrder,
      columnFilters,
      rowSelection,
    },
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 25,
      },
    },
  });

  const selectedCount = Object.keys(rowSelection).length;

  const handleCopyToClipboard = async () => {
    const csv = recordsToCsv(currentRecords, visibleFields, { includeMetadata: false, useBom: false });
    try {
      await navigator.clipboard.writeText(csv);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (error: unknown) {
      setGridError(`The table was not copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 p-4 text-left h-full bg-surface-sunken/30">
      {gridError && (
        <Banner tone="danger" onDismiss={() => setGridError(null)}>
          {gridError}
        </Banner>
      )}

      {runSummary && runSummary.recordsDetected > 0 && (
        <p className="text-2xs text-fg-subtle" aria-label="Extraction summary">
          {runSummary.recordsDetected} detected, {runSummary.totalExtracted} kept,{' '}
          {runSummary.recordsWithMissingFields} with missing fields, {runSummary.recordsFiltered} filtered,{' '}
          {runSummary.recordsFailed} failed, {runSummary.duplicatesSkipped} duplicates skipped
        </p>
      )}

      {/* Top Header & Actions */}
      <div className="flex flex-col gap-2 bg-surface p-3 rounded-xl border border-line/80 shadow-xs">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-bold text-fg leading-tight">
              {dataset?.name || 'Local Data Workspace'}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-fg-subtle mt-0.5">
              <Badge variant="brand" size="sm">
                {currentRecords.length} records
              </Badge>
              <span>•</span>
              <span>{visibleFields.length} columns</span>
              {selectedCount > 0 && (
                <>
                  <span>•</span>
                  <span className="text-brand-fg font-semibold">{selectedCount} selected</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {onNewExtraction && (
              <Button
                variant="subtle"
                size="xs"
                iconLeft={<PlusCircle className="w-3.5 h-3.5 text-brand-fg" />}
                onClick={onNewExtraction}
              >
                New Extraction
              </Button>
            )}

            <Button
              variant="outline"
              size="xs"
              iconLeft={copyFeedback ? <Check className="w-3.5 h-3.5 text-brand-fg" /> : <Copy className="w-3.5 h-3.5" />}
              onClick={handleCopyToClipboard}
              title="Copy table as CSV"
            >
              {copyFeedback ? 'Copied!' : 'Copy'}
            </Button>

            <Button
              variant="primary"
              size="xs"
              iconLeft={<Download className="w-3.5 h-3.5" />}
              onClick={() => setShowExportDialog(true)}
            >
              Export
            </Button>
          </div>
        </div>

        {/* Global Filter Bar, Column Visibility, Column Filters Toggle */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-line-subtle flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Input
              placeholder="Search across all columns..."
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              iconLeft={<Search className="w-3.5 h-3.5" />}
              className="py-1 text-xs"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant={showFilterBar ? 'primary' : 'outline'}
              size="xs"
              iconLeft={<Filter className="w-3 h-3" />}
              onClick={() => setShowFilterBar(!showFilterBar)}
            >
              Filters
            </Button>

            <div className="relative">
              <Button
                variant="outline"
                size="xs"
                iconLeft={<SlidersHorizontal className="w-3 h-3" />}
                onClick={() => setShowColMenu(!showColMenu)}
              >
                Columns
              </Button>

              {showColMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 w-48 bg-surface border border-line rounded-xl shadow-lg p-2 text-xs flex flex-col gap-1 max-h-60 overflow-y-auto">
                  <span className="font-semibold text-fg-muted px-1 py-0.5 border-b border-line-subtle">
                    Visible Columns
                  </span>
                  {table.getAllLeafColumns().map((column) => {
                    if (column.id === '__select' || column.id === '__actions') return null;
                    return (
                      <label
                        key={column.id}
                        className="flex items-center gap-2 px-1 py-1 hover:bg-surface-sunken rounded cursor-pointer text-fg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={column.getToggleVisibilityHandler()}
                          className="w-3.5 h-3.5 rounded border-line-strong text-brand-fg focus:ring-focus"
                        />
                        <span className="truncate">{column.id}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Data Cleaning Toolbar */}
      <DataCleaningToolbar
        canUndo={cleaningHistory.canUndo()}
        canRedo={cleaningHistory.canRedo()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onRemoveDuplicates={handleRemoveDuplicates}
        onRemoveEmptyRows={handleRemoveEmptyRows}
        onRemoveEmptyColumns={handleRemoveEmptyColumns}
        onTrimWhitespace={handleTrimWhitespace}
        onFindAndReplace={handleFindAndReplace}
        onNormalizeValues={handleNormalizeValues}
        fields={currentFields}
        feedbackMessage={cleaningFeedback}
      />

      {/* Selection Action Banner */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-brand-soft/80 border border-brand-line rounded-lg text-xs text-brand-emphasis">
          <span className="font-medium">{selectedCount} row(s) selected</span>
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="xs"
              onClick={handleDeleteSelectedRows}
              iconLeft={<Trash2 className="w-3 h-3" />}
            >
              Delete Selected
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setRowSelection({})}
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Error State Banner */}
      {error && (
        <div className="flex items-center justify-between p-3 bg-danger-soft border border-danger-line rounded-xl text-xs text-danger-emphasis">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-danger-fg shrink-0" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <Button
              variant="outline"
              size="xs"
              onClick={onRetry}
              iconLeft={<RefreshCw className="w-3 h-3" />}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Loading State Banner */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 bg-surface border border-line rounded-xl">
          <Loader2 className="w-8 h-8 text-brand-fg animate-spin mb-3" />
          <h4 className="text-sm font-semibold text-fg">Loading data workspace...</h4>
          <p className="text-xs text-fg-subtle mt-1">Retrieving records from IndexedDB</p>
        </div>
      ) : currentRecords.length === 0 ? (
        /* Empty State */
        <EmptyState
          icon={<FileSpreadsheet className="w-8 h-8 text-fg-subtle" />}
          title="No rows yet"
          description="Run an extraction to fill this table. Rows appear here as soon as they are saved."
          action={onNewExtraction ? { label: 'Start an extraction', onClick: onNewExtraction } : null}
        />
      ) : (
        /* Spreadsheet Data Table */
        <div className="flex-1 flex flex-col min-h-0 border border-line rounded-xl bg-surface shadow-xs overflow-hidden">
          <div className="overflow-x-auto overflow-y-auto flex-1">
            <table className="w-full border-collapse text-left text-xs" style={{ width: table.getTotalSize() }}>
              <thead className="bg-surface-sunken/90 sticky top-0 z-10 border-b border-line text-fg-muted font-semibold select-none">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort() && header.id !== '__select' && header.id !== '__actions';
                      return (
                        <th
                          key={header.id}
                          style={{ width: header.getSize() }}
                          className="relative px-3 py-2 text-left font-semibold border-r border-line/60 last:border-r-0 whitespace-nowrap"
                        >
                          {header.isPlaceholder ? null : (
                            <div className="flex flex-col gap-1">
                              <div
                                onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                                className={`flex items-center gap-1.5 ${canSort ? 'cursor-pointer hover:text-fg' : ''}`}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {canSort && (
                                  <span className="text-fg-subtle">
                                    {header.column.getIsSorted() === 'asc' ? (
                                      <ArrowUp className="w-3 h-3 text-brand-fg" />
                                    ) : header.column.getIsSorted() === 'desc' ? (
                                      <ArrowDown className="w-3 h-3 text-brand-fg" />
                                    ) : (
                                      <ArrowUpDown className="w-3 h-3 opacity-30 hover:opacity-100" />
                                    )}
                                  </span>
                                )}
                              </div>

                              {/* Per-column filter input */}
                              {showFilterBar && header.id !== '__select' && header.id !== '__actions' && (
                                <input
                                  type="text"
                                  value={(header.column.getFilterValue() as string) ?? ''}
                                  onChange={(e) => header.column.setFilterValue(e.target.value)}
                                  placeholder={`Filter ${header.id}...`}
                                  className="w-full px-1.5 py-0.5 text-2xs font-normal border border-line rounded bg-surface"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}
                            </div>
                          )}

                          {/* Column Resize Handle */}
                          {header.column.getCanResize() && (
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-brand ${
                                header.column.getIsResizing() ? 'bg-brand w-2' : ''
                              }`}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-line-subtle text-fg-muted">
                {table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-10 text-center text-fg-subtle">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`hover:bg-surface-sunken/80 transition-colors ${
                        row.getIsSelected() ? 'bg-brand-soft/40' : ''
                      }`}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          style={{ width: cell.column.getSize() }}
                          className="px-3 py-1.5 border-r border-line-subtle last:border-r-0 max-w-[250px]"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer / Pagination */}
          <div className="p-2.5 bg-surface-sunken border-t border-line flex items-center justify-between text-xs text-fg-muted flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <select
                value={table.getState().pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
                className="rounded border border-line-strong bg-surface px-2 py-0.5 text-xs text-fg-muted focus:outline-none"
              >
                {[10, 25, 50, 100].map((pageSize) => (
                  <option key={pageSize} value={pageSize}>
                    {pageSize}
                  </option>
                ))}
              </select>
              <span className="text-fg-subtle">|</span>
              <span>
                Showing {table.getRowModel().rows.length > 0 ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1 : 0} -{' '}
                {Math.min(
                  (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                  table.getFilteredRowModel().rows.length
                )}{' '}
                of {table.getFilteredRowModel().rows.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span>
                Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
              </span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Previous table page"
                  className="p-1 rounded border border-line bg-surface text-fg-muted hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Next table page"
                  className="p-1 rounded border border-line bg-surface text-fg-muted hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rename Column Modal */}
      {renamingCol && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/30 backdrop-blur-2xs p-4">
          <div className="bg-surface rounded-xl shadow-xl border border-line w-full max-w-xs p-4 flex flex-col gap-3">
            <span className="font-bold text-fg text-xs">Rename Column "{renamingCol}"</span>
            <input
              type="text"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="Enter new column name..."
              className="w-full px-2.5 py-1 text-xs border border-line rounded-lg focus:outline-none focus:border-brand"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-subtle">
              <Button variant="outline" size="xs" onClick={() => setRenamingCol(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="xs"
                disabled={!newColName.trim()}
                onClick={handleRenameColumnSubmit}
              >
                Rename
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Export Dialog */}
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        records={currentRecords}
        fields={currentFields}
        dataset={dataset}
        activeColumnOrder={table.getState().columnOrder.filter((c) => c !== '__select' && c !== '__actions')}
      />
    </div>
  );
};
