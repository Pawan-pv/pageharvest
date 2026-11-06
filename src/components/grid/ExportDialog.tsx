import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, FileJson, Download, X } from 'lucide-react';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { ExtractedRecord, FieldDefinition, Dataset } from '@/types';
import {
  recordsToCsv,
  recordsToJson,
  generateExportFilename,
} from '@/core/export/exporter';
import { triggerDownload } from '@/platform/downloads';
import { SettingsRepository } from '@/storage/repositories/settings-repository';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  records: ExtractedRecord[];
  fields: FieldDefinition[];
  dataset?: Dataset | null;
  activeColumnOrder?: string[];
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  records,
  fields,
  dataset,
  activeColumnOrder,
}) => {
  const [format, setFormat] = useState<'csv' | 'json' | 'ndjson'>('csv');
  const [includeBom, setIncludeBom] = useState(true);
  const [delimiter, setDelimiter] = useState<',' | ';' | '\t'>(',');
  const [prettyJson, setPrettyJson] = useState(true);
  const [jsonIndent, setJsonIndent] = useState(2);
  const [includeMetadata, setIncludeMetadata] = useState(false);
  const [customFilename, setCustomFilename] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Start from the saved preferences each time the dialog opens.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    new SettingsRepository()
      .getSettings()
      .then((settings) => {
        if (cancelled) return;
        setFormat(settings.defaultExportFormat);
        setIncludeBom(settings.csvIncludeBom);
        setDelimiter(settings.csvDelimiter);
        setJsonIndent(settings.jsonIndent);
        setPrettyJson(settings.jsonIndent > 0);
      })
      .catch((error: unknown) => {
        console.warn('Could not load export preferences:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const datasetName = dataset?.name || 'harvested-data';
  const autoFilename = generateExportFilename({
    datasetName: customFilename.trim() || datasetName,
    format,
  });

  const handleExport = async () => {
    const filename = customFilename.trim() ? `${customFilename.trim()}.${format === 'ndjson' ? 'ndjson' : format}` : autoFilename;

    setIsExporting(true);
    setExportError(null);
    try {
      let result;
      if (format === 'csv') {
        const csv = recordsToCsv(records, fields, {
          useBom: includeBom,
          delimiter,
          includeMetadata,
          orderedColumns: activeColumnOrder,
        });
        result = await triggerDownload({ content: csv, filename, mimeType: 'text/csv' });
      } else {
        const json = recordsToJson(records, fields, {
          pretty: format === 'json' && prettyJson,
          indent: jsonIndent || 2,
          format,
          includeMetadata,
          orderedColumns: activeColumnOrder,
        });
        const mimeType = format === 'ndjson' ? 'application/x-ndjson' : 'application/json';
        result = await triggerDownload({ content: json, filename, mimeType });
      }

      // The dialog only closes once the browser has accepted the download.
      if (result.success) {
        onClose();
      } else {
        setExportError(result.error ?? 'The download did not start.');
      }
    } catch (error: unknown) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 backdrop-blur-xs p-4">
      <div className="bg-surface rounded-2xl shadow-2xl border border-line w-full max-w-md overflow-hidden text-left flex flex-col animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-subtle bg-surface-sunken/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand-soft text-brand-fg">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-fg">Export Extracted Data</h3>
              <p className="text-xs text-fg-subtle">
                {records.length} records ready to export
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-fg-subtle hover:text-fg-muted hover:bg-surface-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {exportError && (
            <Alert variant="error" title="Export failed">
              {exportError}
            </Alert>
          )}

          {/* Format Selection */}
          <div className="flex flex-col gap-1.5">
            <label className="font-semibold text-fg-muted">Format</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormat('csv')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  format === 'csv'
                    ? 'border-brand bg-brand-soft/50 text-brand-emphasis font-semibold shadow-xs'
                    : 'border-line hover:bg-surface-sunken text-fg-muted'
                }`}
              >
                <FileSpreadsheet className="w-5 h-5 mb-1 text-brand-fg" />
                <span>CSV</span>
                <span className="text-2xs text-fg-subtle font-normal">Excel / Sheets</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('json')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  format === 'json'
                    ? 'border-brand bg-brand-soft/50 text-brand-emphasis font-semibold shadow-xs'
                    : 'border-line hover:bg-surface-sunken text-fg-muted'
                }`}
              >
                <FileJson className="w-5 h-5 mb-1 text-brand-fg" />
                <span>JSON</span>
                <span className="text-2xs text-fg-subtle font-normal">Standard Array</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('ndjson')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  format === 'ndjson'
                    ? 'border-brand bg-brand-soft/50 text-brand-emphasis font-semibold shadow-xs'
                    : 'border-line hover:bg-surface-sunken text-fg-muted'
                }`}
              >
                <FileJson className="w-5 h-5 mb-1 text-brand-fg" />
                <span>NDJSON</span>
                <span className="text-2xs text-fg-subtle font-normal">Line-Delimited</span>
              </button>
            </div>
          </div>

          {/* Options depending on format */}
          {format === 'csv' && (
            <div className="flex flex-col gap-3 p-3 bg-surface-sunken/80 rounded-xl border border-line-subtle">
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Include UTF-8 BOM (for Excel)</span>
                <input
                  type="checkbox"
                  checked={includeBom}
                  onChange={(e) => setIncludeBom(e.target.checked)}
                  className="w-4 h-4 rounded text-brand-fg border-line-strong focus:ring-focus"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Delimiter</span>
                <select
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value as ',' | ';' | '\t')}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-fg-muted"
                >
                  <option value=",">Comma (,)</option>
                  <option value=";">Semicolon (;)</option>
                  <option value="&#9;">Tab (\t)</option>
                </select>
              </div>
            </div>
          )}

          {format === 'json' && (
            <div className="flex items-center justify-between p-3 bg-surface-sunken/80 rounded-xl border border-line-subtle">
              <span className="text-fg-muted">Pretty Indentation (2 spaces)</span>
              <input
                type="checkbox"
                checked={prettyJson}
                onChange={(e) => setPrettyJson(e.target.checked)}
                className="w-4 h-4 rounded text-brand-fg border-line-strong focus:ring-focus"
              />
            </div>
          )}

          {/* Include provenance metadata */}
          <div className="flex items-center justify-between">
            <span className="text-fg-muted">Include metadata (_id, _page, _extractedAt)</span>
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              className="w-4 h-4 rounded text-brand-fg border-line-strong focus:ring-focus"
            />
          </div>

          {/* Filename Preview */}
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-fg-muted">Custom Filename (optional)</label>
            <input
              type="text"
              placeholder={autoFilename}
              value={customFilename}
              onChange={(e) => setCustomFilename(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-line text-xs text-fg placeholder-fg-subtle focus:outline-none focus:border-brand"
            />
            <span className="text-2xs text-fg-subtle">
              File will be saved as: <code className="text-fg-muted">{customFilename.trim() ? `${customFilename.trim()}.${format === 'ndjson' ? 'ndjson' : format}` : autoFilename}</code>
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line-subtle bg-surface-sunken/50">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Download className="w-3.5 h-3.5" />}
            isLoading={isExporting}
            onClick={() => void handleExport()}
          >
            Download File
          </Button>
        </div>
      </div>
    </div>
  );
};
