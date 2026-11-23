import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Pencil, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Dialog } from '@/components/common/Dialog';
import { Input } from '@/components/common/Input';
import type { Dataset } from '@/types';
import { relativeTime } from '@/utils/relative-time';

export interface DatasetSwitcherProps {
  datasets: Dataset[];
  activeId?: string | null;
  onSelect: (dataset: Dataset) => void;
  onRename: (datasetId: string, name: string) => Promise<void>;
  onDelete: (datasetId: string) => Promise<void>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The workbench's table picker: every saved list, searchable, with its site, age and row
 * count. Renaming and deleting happen here too, both through the background writer.
 */
export const DatasetSwitcher: React.FC<DatasetSwitcherProps> = ({
  datasets,
  activeId,
  onSelect,
  onRename,
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const active = datasets.find((dataset) => dataset.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setProblem(null);
  }, [open]);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return datasets;
    return datasets.filter(
      (dataset) =>
        dataset.name.toLowerCase().includes(query) || dataset.url.toLowerCase().includes(query)
    );
  }, [datasets, search]);

  const startRename = (dataset: Dataset) => {
    setRenamingId(dataset.id);
    setRenameValue(dataset.name);
    setProblem(null);
  };

  const saveRename = async (datasetId: string) => {
    const name = renameValue.trim();
    if (!name) {
      setProblem('A saved list needs a name.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onRename(datasetId, name);
      setRenamingId(null);
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    setProblem(null);
    try {
      await onDelete(deleting.id);
      setDeleting(null);
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-left text-xs text-fg shadow-xs hover:bg-surface-sunken"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{active?.name ?? 'Choose a saved list'}</span>
          {active && (
            <span className="truncate text-2xs text-fg-subtle">
              {hostOf(active.url) || 'This page'} · {relativeTime(active.createdAt)}
            </span>
          )}
        </span>
        <ChevronDown aria-hidden="true" className="w-4 h-4 shrink-0 text-fg-subtle" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Saved lists"
            className="absolute left-0 top-full z-40 mt-1 flex w-full min-w-[18rem] max-w-md flex-col gap-2 rounded-xl border border-line bg-surface p-2 shadow-xl"
          >
            <Input
              aria-label="Search saved lists"
              placeholder="Search by name or website"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              iconLeft={<Search aria-hidden="true" className="w-3.5 h-3.5" />}
              className="py-1 text-xs"
            />

            {problem && (
              <p role="alert" className="text-2xs text-danger-fg">
                {problem}
              </p>
            )}

            <ul className="max-h-72 overflow-y-auto flex flex-col gap-0.5">
              {shown.length === 0 ? (
                <li className="px-2 py-3 text-center text-xs text-fg-subtle">
                  {datasets.length === 0 ? 'Nothing saved yet.' : `Nothing matches "${search.trim()}".`}
                </li>
              ) : (
                shown.map((dataset) => (
                  <li key={dataset.id} className="min-w-0">
                    {renamingId === dataset.id ? (
                      <div className="flex items-center gap-1 px-1 py-1">
                        <Input
                          aria-label={`New name for ${dataset.name}`}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveRename(dataset.id);
                            if (event.key === 'Escape') setRenamingId(null);
                          }}
                          autoFocus
                          className="py-1 text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label="Save name"
                          disabled={busy}
                          onClick={() => void saveRename(dataset.id)}
                          iconLeft={<Check aria-hidden="true" className="w-3.5 h-3.5" />}
                        />
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label="Cancel rename"
                          onClick={() => setRenamingId(null)}
                          iconLeft={<X aria-hidden="true" className="w-3.5 h-3.5" />}
                        />
                      </div>
                    ) : (
                      <div
                        className={`flex items-center gap-1 rounded-lg px-1 py-1 ${
                          dataset.id === activeId ? 'bg-brand-soft/50' : 'hover:bg-surface-sunken'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(dataset);
                            setOpen(false);
                          }}
                          className="flex min-w-0 flex-1 flex-col items-start px-1 py-0.5 text-left"
                        >
                          <span className="w-full truncate text-xs font-medium text-fg">{dataset.name}</span>
                          <span className="w-full truncate text-2xs text-fg-subtle">
                            {hostOf(dataset.url) || 'This page'} · {relativeTime(dataset.createdAt)}
                          </span>
                        </button>
                        <span className="shrink-0 rounded-full border border-line/80 bg-surface-muted px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-fg-muted">
                          {dataset.recordsCount.toLocaleString('en-US')}
                        </span>
                        <button
                          type="button"
                          aria-label={`Rename ${dataset.name}`}
                          title="Rename"
                          onClick={() => startRename(dataset)}
                          className="shrink-0 rounded p-1 text-fg-faint hover:text-brand-fg"
                        >
                          <Pencil aria-hidden="true" className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${dataset.name}`}
                          title="Delete"
                          onClick={() => setDeleting(dataset)}
                          className="shrink-0 rounded p-1 text-fg-faint hover:text-danger-fg"
                        >
                          <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}

      <Dialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this saved list?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button variant="danger" size="sm" isLoading={busy} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        {deleting && (
          <p>
            “{deleting.name}” and its {deleting.recordsCount.toLocaleString('en-US')} rows will be removed from this
            computer. Files you already downloaded are not touched. This cannot be undone.
          </p>
        )}
      </Dialog>
    </div>
  );
};
