import React, { useState } from 'react';
import {
  Sparkles,
  Undo2,
  Redo2,
  CopyX,
  Trash,
  Replace,
  Scissors,
  Wand2,
  AlertTriangle,
  X,
  Check,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { FieldDefinition } from '@/types';

export interface DataCleaningToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRemoveDuplicates: () => void;
  onRemoveEmptyRows: () => void;
  onRemoveEmptyColumns: () => void;
  onTrimWhitespace: () => void;
  onFindAndReplace: (options: {
    find: string;
    replace: string;
    column?: string;
    matchCase: boolean;
  }) => void;
  onNormalizeValues: (
    column: string,
    type: 'number' | 'url' | 'lowercase' | 'uppercase' | 'titlecase' | 'boolean'
  ) => void;
  fields: FieldDefinition[];
  feedbackMessage?: string | null;
}

export const DataCleaningToolbar: React.FC<DataCleaningToolbarProps> = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRemoveDuplicates,
  onRemoveEmptyRows,
  onRemoveEmptyColumns,
  onTrimWhitespace,
  onFindAndReplace,
  onNormalizeValues,
  fields,
  feedbackMessage,
}) => {
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [targetColumn, setTargetColumn] = useState<string>('all');
  const [matchCase, setMatchCase] = useState(false);

  const [showNormalizeMenu, setShowNormalizeMenu] = useState(false);
  const [normalizeColumn, setNormalizeColumn] = useState<string>(fields[0]?.name || '');
  const [normalizeType, setNormalizeType] = useState<
    'number' | 'url' | 'lowercase' | 'uppercase' | 'titlecase' | 'boolean'
  >('number');

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  const handleExecuteFindReplace = () => {
    if (!findText) return;
    onFindAndReplace({
      find: findText,
      replace: replaceText,
      column: targetColumn === 'all' ? undefined : targetColumn,
      matchCase,
    });
    setShowFindReplace(false);
    setFindText('');
    setReplaceText('');
  };

  const handleExecuteNormalize = () => {
    if (!normalizeColumn) return;
    onNormalizeValues(normalizeColumn, normalizeType);
    setShowNormalizeMenu(false);
  };

  return (
    <div className="flex flex-col gap-1.5 bg-slate-50 border border-slate-200/80 rounded-xl p-2 text-xs">
      {/* Toolbar actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="flex items-center gap-1 font-semibold text-slate-700 mr-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            Clean:
          </span>

          <Button
            variant="outline"
            size="xs"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo last cleaning operation"
            iconLeft={<Undo2 className="w-3 h-3" />}
          >
            Undo
          </Button>

          <Button
            variant="outline"
            size="xs"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo cleaning operation"
            iconLeft={<Redo2 className="w-3 h-3" />}
          >
            Redo
          </Button>

          <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

          <Button
            variant="subtle"
            size="xs"
            onClick={() =>
              setConfirmDialog({
                title: 'Remove Duplicate Rows',
                description:
                  'Identical records matching across all columns will be removed. You can undo this action if needed.',
                onConfirm: onRemoveDuplicates,
              })
            }
            iconLeft={<CopyX className="w-3 h-3 text-slate-500" />}
          >
            Remove Duplicates
          </Button>

          <Button
            variant="subtle"
            size="xs"
            onClick={onRemoveEmptyRows}
            iconLeft={<Trash className="w-3 h-3 text-slate-500" />}
          >
            Remove Empty Rows
          </Button>

          <Button
            variant="subtle"
            size="xs"
            onClick={() =>
              setConfirmDialog({
                title: 'Remove Empty Columns',
                description:
                  'Columns that have no extracted values in any row will be removed from your table schema.',
                onConfirm: onRemoveEmptyColumns,
              })
            }
            iconLeft={<Trash className="w-3 h-3 text-slate-500" />}
          >
            Remove Empty Columns
          </Button>

          <Button
            variant="subtle"
            size="xs"
            onClick={onTrimWhitespace}
            iconLeft={<Scissors className="w-3 h-3 text-slate-500" />}
          >
            Trim Spaces
          </Button>

          <Button
            variant="subtle"
            size="xs"
            onClick={() => setShowFindReplace(true)}
            iconLeft={<Replace className="w-3 h-3 text-slate-500" />}
          >
            Find & Replace
          </Button>

          <Button
            variant="subtle"
            size="xs"
            onClick={() => setShowNormalizeMenu(!showNormalizeMenu)}
            iconLeft={<Wand2 className="w-3 h-3 text-slate-500" />}
          >
            Normalize
          </Button>
        </div>

        {feedbackMessage && (
          <div className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-medium border border-emerald-200 animate-in fade-in">
            <Check className="w-3 h-3" />
            <span>{feedbackMessage}</span>
          </div>
        )}
      </div>

      {/* Normalize Menu Dropdown */}
      {showNormalizeMenu && (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60 flex-wrap">
          <span className="text-slate-600 font-medium">Normalize column:</span>
          <select
            value={normalizeColumn}
            onChange={(e) => setNormalizeColumn(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
          >
            {fields.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>

          <select
            value={normalizeType}
                  onChange={(e) =>
                    setNormalizeType(
                      e.target.value as
                        | 'number'
                        | 'url'
                        | 'lowercase'
                        | 'uppercase'
                        | 'titlecase'
                        | 'boolean'
                    )
                  }
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
          >
            <option value="number">Parse Number / Price (strip $ ,)</option>
            <option value="url">Resolve Full URL</option>
            <option value="titlecase">Title Case</option>
            <option value="lowercase">lowercase</option>
            <option value="uppercase">UPPERCASE</option>
            <option value="boolean">Boolean (true / false)</option>
          </select>

          <Button variant="primary" size="xs" onClick={handleExecuteNormalize}>
            Apply
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setShowNormalizeMenu(false)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Find and Replace Modal Dialog */}
      {showFindReplace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-2xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="font-bold text-slate-900">Find & Replace</span>
              <button
                onClick={() => setShowFindReplace(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div>
                <label className="text-[11px] font-semibold text-slate-600">Find</label>
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="Text to find..."
                  className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600">Replace with</label>
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Replacement text..."
                  className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-slate-600">Column</label>
                <select
                  value={targetColumn}
                  onChange={(e) => setTargetColumn(e.target.value)}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value="all">All Columns</option>
                  {fields.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={matchCase}
                  onChange={(e) => setMatchCase(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-emerald-600 border-slate-300"
                />
                <span className="text-slate-600">Match Case</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" size="xs" onClick={() => setShowFindReplace(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="xs"
                disabled={!findText}
                onClick={handleExecuteFindReplace}
              >
                Replace All
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Destructive Action Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-amber-600 font-bold">
              <AlertTriangle className="w-4 h-4" />
              <span>{confirmDialog.title}</span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {confirmDialog.description}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" size="xs" onClick={() => setConfirmDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="xs"
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
