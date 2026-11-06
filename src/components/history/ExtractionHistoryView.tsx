import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Trash2,
  Search,
  Calendar,
  FileJson,
  Database,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { EmptyState } from '@/components/common/EmptyState';
import { Alert } from '@/components/common/Alert';
import { Dataset, ExtractedRecord } from '@/types';
import {
  recordsToCsv,
  recordsToJson,
} from '@/core/export/exporter';
import { DownloadOptions, triggerDownload } from '@/platform/downloads';
import { SettingsRepository } from '@/storage/repositories/settings-repository';

export interface ExtractionHistoryViewProps {
  datasets: Dataset[];
  isLoading?: boolean;
  onViewDataset: (dataset: Dataset) => void;
  onDeleteDataset: (datasetId: string) => Promise<void>;
  onGetDatasetRecords: (datasetId: string) => Promise<ExtractedRecord[]>;
  onNewExtraction: () => void;
}

export const ExtractionHistoryView: React.FC<ExtractionHistoryViewProps> = ({
  datasets,
  isLoading = false,
  onViewDataset,
  onDeleteDataset,
  onGetDatasetRecords,
  onNewExtraction,
}) => {
  const [search, setSearch] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = datasets.filter((ds) => {
    const q = search.toLowerCase();
    return ds.name.toLowerCase().includes(q) || ds.url.toLowerCase().includes(q);
  });

  const runExport = async (build: () => Promise<DownloadOptions>) => {
    setActionError(null);
    try {
      const result = await triggerDownload(await build());
      if (!result.success) {
        setActionError(`Export failed: ${result.error ?? 'the download did not start.'}`);
      }
    } catch (error: unknown) {
      setActionError(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleExportCsv = (dataset: Dataset, e: React.MouseEvent) => {
    e.stopPropagation();
    void runExport(async () => {
      const [records, settings] = await Promise.all([
        onGetDatasetRecords(dataset.id),
        new SettingsRepository().getSettings(),
      ]);
      const content = recordsToCsv(records, dataset.fields, {
        includeMetadata: false,
        useBom: settings.csvIncludeBom,
        delimiter: settings.csvDelimiter,
      });
      const name = dataset.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      return { content, filename: `${name}.csv`, mimeType: 'text/csv' };
    });
  };

  const handleExportJson = (dataset: Dataset, e: React.MouseEvent) => {
    e.stopPropagation();
    void runExport(async () => {
      const [records, settings] = await Promise.all([
        onGetDatasetRecords(dataset.id),
        new SettingsRepository().getSettings(),
      ]);
      const content = recordsToJson(records, dataset.fields, {
        includeMetadata: false,
        pretty: settings.jsonIndent > 0,
        indent: settings.jsonIndent,
      });
      const name = dataset.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      return { content, filename: `${name}.json`, mimeType: 'application/json' };
    });
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      await onDeleteDataset(deleteTargetId);
      setDeleteTargetId(null);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error));
      setDeleteTargetId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 text-left h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-fg leading-tight">
            Saved Extractions
          </h2>
          <p className="text-xs text-fg-subtle mt-0.5">
            Locally stored in IndexedDB on this browser
          </p>
        </div>

        <Button
          variant="outline"
          size="xs"
          onClick={onNewExtraction}
        >
          New Extraction
        </Button>
      </div>

      {actionError && (
        <Alert variant="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {/* Search Input */}
      {datasets.length > 0 && (
        <Input
          placeholder="Search saved datasets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          iconLeft={<Search className="w-3.5 h-3.5" />}
          className="py-1 text-xs"
        />
      )}

      {/* Dataset List */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-fg-subtle">
          Loading extraction history...
        </div>
      ) : datasets.length === 0 ? (
        <EmptyState
          icon={<Database className="w-6 h-6" />}
          title="No saved datasets yet"
          description="Harvest websites to build and store clean spreadsheets entirely offline."
          action={
            <Button variant="primary" size="sm" onClick={onNewExtraction}>
              Start First Extraction
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <div className="p-6 text-center text-xs text-fg-subtle">
          No datasets matching "{search}".
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-170px)]">
          {filtered.map((dataset) => (
            <Card
              key={dataset.id}
              variant="interactive"
              onClick={() => onViewDataset(dataset)}
              className="p-3.5 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-fg truncate">
                    {dataset.name}
                  </h3>
                  <a
                    href={dataset.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-2xs text-fg-subtle hover:text-brand-fg truncate block mt-0.5 max-w-[240px]"
                    title={dataset.url}
                  >
                    {dataset.url}
                  </a>
                </div>

                <Badge variant="brand" size="sm">
                  {dataset.recordsCount} rows
                </Badge>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-line-subtle text-2xs text-fg-subtle">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  <span>{new Date(dataset.createdAt).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>{dataset.fields.length} columns</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => handleExportCsv(dataset, e)}
                    title="Export as CSV"
                    aria-label={`Export ${dataset.name} as CSV`}
                    className="p-1 text-fg-subtle hover:text-brand-fg rounded hover:bg-surface-muted transition-colors"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => handleExportJson(dataset, e)}
                    title="Export as JSON"
                    aria-label={`Export ${dataset.name} as JSON`}
                    className="p-1 text-fg-subtle hover:text-brand-fg rounded hover:bg-surface-muted transition-colors"
                  >
                    <FileJson className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTargetId(dataset.id);
                    }}
                    title="Delete dataset"
                    aria-label={`Delete dataset ${dataset.name}`}
                    className="p-1 text-fg-subtle hover:text-danger-fg rounded hover:bg-danger-soft transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title="Delete Dataset?"
        description="This will permanently delete this dataset and all its extracted records from local storage."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTargetId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={isDeleting}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-xs text-fg-muted">
          Are you sure you want to proceed? This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
};
