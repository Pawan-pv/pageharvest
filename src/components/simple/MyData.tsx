import React, { useState } from 'react';
import { FileSpreadsheet, Search, Trash2 } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Dialog } from '@/components/common/Dialog';
import { EmptyState } from '@/components/common/EmptyState';
import { Input } from '@/components/common/Input';
import { SavedFileNotice } from '@/components/common/SavedFileNotice';
import { downloadRows } from '@/components/grid/download-rows';
import type { Dataset, ExtractedRecord } from '@/types';
import { rowCount } from './Done';

export interface SimpleMyDataProps {
  datasets: Dataset[];
  isLoading?: boolean;
  onViewDataset: (dataset: Dataset) => void;
  onDeleteDataset: (datasetId: string) => Promise<void>;
  onGetDatasetRecords: (datasetId: string) => Promise<ExtractedRecord[]>;
  onNewExtraction: () => void;
}

/** A search box is only worth its space once the list is longer than a glance. */
const SEARCH_FROM = 6;

function siteOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Everything the user has collected, in simple mode (ADR-039): open it, save it as an Excel
 * file, or delete it. Groups, saved setups, column sets and the run history are the same
 * data seen other ways, and are under Advanced options.
 */
export const SimpleMyData: React.FC<SimpleMyDataProps> = ({
  datasets,
  isLoading = false,
  onViewDataset,
  onDeleteDataset,
  onGetDatasetRecords,
  onNewExtraction,
}) => {
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<Dataset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const shown = query
    ? datasets.filter((item) => item.name.toLowerCase().includes(query) || item.url.toLowerCase().includes(query))
    : datasets;

  const download = async (dataset: Dataset) => {
    setBusyId(dataset.id);
    setProblem(null);
    setDownloadId(null);
    try {
      const records = await onGetDatasetRecords(dataset.id);
      const result = await downloadRows(records, dataset.fields, { format: 'xlsx', name: dataset.name });
      if (!result.success) {
        setProblem(result.error ?? 'The download did not start.');
      } else if (typeof result.downloadId === 'number') {
        setDownloadId(result.downloadId);
      }
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    setProblem(null);
    try {
      await onDeleteDataset(deleting.id);
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeleting(false);
      setDeleting(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      <div>
        <h2 className="text-base font-semibold text-fg">My data</h2>
        <p className="text-body text-fg-muted mt-1">Every list you collect is saved here, on this computer.</p>
      </div>

      {downloadId !== null && <SavedFileNotice downloadId={downloadId} onDismiss={() => setDownloadId(null)} />}
      {problem && (
        <Banner
          tone="danger"
          title="That did not work"
          dataSafety="Nothing was changed."
          nextStep="Try again."
          details={problem}
          onDismiss={() => setProblem(null)}
        />
      )}

      {datasets.length >= SEARCH_FROM && (
        <Input
          aria-label="Search my data"
          placeholder="Search by name or website"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          iconLeft={<Search aria-hidden="true" className="w-3.5 h-3.5" />}
        />
      )}

      {isLoading ? (
        <p className="text-body text-fg-muted" role="status">
          Loading your data…
        </p>
      ) : datasets.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet className="w-5 h-5" />}
          title="Nothing saved yet"
          description="Open a website with a list on it, then press the button to collect it. It will be kept here."
          action={{ label: 'Get a list', onClick: onNewExtraction }}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={`Nothing matches "${search.trim()}"`}
          description="Try another word from the name or the website."
          action={{ label: 'Clear search', onClick: () => setSearch('') }}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((dataset) => {
            const site = siteOf(dataset.url);
            return (
              <li key={dataset.id}>
                <Card className="flex flex-col gap-2 p-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-fg break-words line-clamp-2">{dataset.name}</h3>
                    <p className="text-body text-fg-muted mt-0.5">
                      {rowCount(dataset.recordsCount)}
                      {site ? ` from ${site}` : ''}, {new Date(dataset.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" aria-label={`Open ${dataset.name}`} onClick={() => onViewDataset(dataset)}>
                      Open
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      iconLeft={<FileSpreadsheet aria-hidden="true" className="w-3.5 h-3.5" />}
                      aria-label={`Download ${dataset.name} for Excel`}
                      isLoading={busyId === dataset.id}
                      disabled={busyId !== null || dataset.recordsCount === 0}
                      onClick={() => void download(dataset)}
                    >
                      Download for Excel
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Trash2 aria-hidden="true" className="w-3.5 h-3.5" />}
                      aria-label={`Delete ${dataset.name}`}
                      onClick={() => setDeleting(dataset)}
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
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
            <Button variant="danger" size="sm" isLoading={isDeleting} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        {deleting && (
          <p>
            “{deleting.name}” and its {rowCount(deleting.recordsCount)} will be removed from this computer. Files you
            already downloaded are not touched. This cannot be undone.
          </p>
        )}
      </Dialog>
    </div>
  );
};
