import React, { useEffect, useMemo, useState } from 'react';
import { Combine } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Dialog } from '@/components/common/Dialog';
import { Input } from '@/components/common/Input';
import type { MergeColumnsOptions } from './grid-features';
import type { ExtractedRecord, FieldDefinition } from '@/types';

export interface MergeColumnsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fields: FieldDefinition[];
  records: ExtractedRecord[];
  onMerge: (options: MergeColumnsOptions) => void;
}

const DEFAULT_DELIMITER = ' ';

/** Joins two or more columns into one, with a live preview of the first row. */
export const MergeColumnsDialog: React.FC<MergeColumnsDialogProps> = ({
  isOpen,
  onClose,
  fields,
  records,
  onMerge,
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [delimiter, setDelimiter] = useState(DEFAULT_DELIMITER);
  const [newName, setNewName] = useState('');
  const [dropSources, setDropSources] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelected([]);
    setDelimiter(DEFAULT_DELIMITER);
    setNewName('');
    setDropSources(true);
    setProblem(null);
  }, [isOpen]);

  const defaultName = useMemo(() => {
    if (selected.length === 0) return '';
    return selected.join(' + ');
  }, [selected]);

  const effectiveName = newName.trim() || defaultName;

  const preview = useMemo(() => {
    if (selected.length < 2) return '';
    const row = records[0] ?? {};
    return selected
      .map((column) => row[column])
      .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
      .map((value) => String(value).trim())
      .join(delimiter);
  }, [records, selected, delimiter]);

  const toggle = (name: string) => {
    setSelected((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
    );
  };

  const submit = () => {
    if (selected.length < 2) {
      setProblem('Choose at least two columns to merge.');
      return;
    }
    if (!effectiveName) {
      setProblem('Give the merged column a name.');
      return;
    }
    try {
      onMerge({ columns: selected, delimiter, newName: effectiveName, dropSources });
      onClose();
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Merge columns"
      description="Join two or more columns into one. The values are kept in the order the columns appear."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Combine aria-hidden="true" className="w-3.5 h-3.5" />}
            disabled={selected.length < 2}
            onClick={submit}
          >
            Merge columns
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-fg-muted">Columns to merge</span>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-line p-1.5 flex flex-col gap-0.5">
            {fields.map((field) => (
              <label
                key={field.name}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-fg-muted hover:bg-surface-sunken cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(field.name)}
                  onChange={() => toggle(field.name)}
                  className="w-3.5 h-3.5 rounded border-line-strong text-brand-fg focus:ring-focus"
                />
                <span className="truncate">{field.name}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-fg-muted">
          Put between values
          <Input
            aria-label="Delimiter"
            value={delimiter}
            onChange={(event) => setDelimiter(event.target.value)}
            placeholder="e.g. a space, a comma, a dash"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-fg-muted">
          New column name
          <Input
            aria-label="New column name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={defaultName || 'Merged column'}
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={dropSources}
            onChange={(event) => setDropSources(event.target.checked)}
            className="w-3.5 h-3.5 rounded border-line-strong text-brand-fg focus:ring-focus"
          />
          Remove the original columns after merging
        </label>

        {selected.length >= 2 && (
          <div className="rounded-lg border border-line-subtle bg-surface-sunken px-2.5 py-2 text-xs text-fg-muted">
            <span className="font-semibold text-fg">First row preview: </span>
            <span className="break-words">{preview || <span className="italic text-fg-faint">empty</span>}</span>
          </div>
        )}

        {problem && (
          <p role="alert" className="text-xs text-danger-fg">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
};
