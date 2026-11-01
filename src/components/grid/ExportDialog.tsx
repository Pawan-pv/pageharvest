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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden text-left flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Export Extracted Data</h3>
              <p className="text-xs text-slate-500">
                {records.length} records ready to export
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
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
            <label className="font-semibold text-slate-700">Format</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormat('csv')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  format === 'csv'
                    ? 'border-emerald-600 bg-emerald-50/50 text-emerald-900 font-semibold shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <FileSpreadsheet className="w-5 h-5 mb-1 text-emerald-600" />
                <span>CSV</span>
                <span className="text-[10px] text-slate-500 font-normal">Excel / Sheets</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('json')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  format === 'json'
                    ? 'border-emerald-600 bg-emerald-50/50 text-emerald-900 font-semibold shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <FileJson className="w-5 h-5 mb-1 text-emerald-600" />
                <span>JSON</span>
                <span className="text-[10px] text-slate-500 font-normal">Standard Array</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat('ndjson')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  format === 'ndjson'
                    ? 'border-emerald-600 bg-emerald-50/50 text-emerald-900 font-semibold shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <FileJson className="w-5 h-5 mb-1 text-emerald-600" />
                <span>NDJSON</span>
                <span className="text-[10px] text-slate-500 font-normal">Line-Delimited</span>
              </button>
            </div>
          </div>

          {/* Options depending on format */}
          {format === 'csv' && (
            <div className="flex flex-col gap-3 p-3 bg-slate-50/80 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-slate-700">Include UTF-8 BOM (for Excel)</span>
                <input
                  type="checkbox"
                  checked={includeBom}
                  onChange={(e) => setIncludeBom(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-700">Delimiter</span>
                <select
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value as ',' | ';' | '\t')}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                >
                  <option value=",">Comma (,)</option>
                  <option value=";">Semicolon (;)</option>
                  <option value="&#9;">Tab (\t)</option>
                </select>
              </div>
            </div>
          )}

          {format === 'json' && (
            <div className="flex items-center justify-between p-3 bg-slate-50/80 rounded-xl border border-slate-100">
              <span className="text-slate-700">Pretty Indentation (2 spaces)</span>
              <input
                type="checkbox"
                checked={prettyJson}
                onChange={(e) => setPrettyJson(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* Include provenance metadata */}
          <div className="flex items-center justify-between">
            <span className="text-slate-700">Include metadata (_id, _page, _extractedAt)</span>
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500"
            />
          </div>

          {/* Filename Preview */}
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-slate-700">Custom Filename (optional)</label>
            <input
              type="text"
              placeholder={autoFilename}
              value={customFilename}
              onChange={(e) => setCustomFilename(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[11px] text-slate-400">
              File will be saved as: <code className="text-slate-600">{customFilename.trim() ? `${customFilename.trim()}.${format === 'ndjson' ? 'ndjson' : format}` : autoFilename}</code>
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
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
