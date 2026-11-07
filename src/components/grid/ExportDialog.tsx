import React, { useEffect, useId, useState } from 'react';
import { Download } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { Dialog } from '@/components/common/Dialog';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { ExtractedRecord, FieldDefinition, Dataset } from '@/types';
import {
  generateExportFilename,
  recordsToCsvChunks,
  recordsToJsonChunks,
  recordsToNdjsonChunks,
  withValueDetails,
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

type ExportFormat = 'csv' | 'xlsx' | 'json' | 'ndjson';
type Delimiter = ',' | ';' | '\t';

const FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'csv', label: 'CSV', description: 'For Excel, Numbers and Google Sheets.' },
  { value: 'xlsx', label: 'Excel', description: 'An Excel workbook, with numbers kept as numbers.' },
  { value: 'json', label: 'JSON', description: 'For developers and other tools.' },
  { value: 'ndjson', label: 'NDJSON', description: 'One row per line, for large data tools.' },
];

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'Comma (,)' },
  { value: ';', label: 'Semicolon (;)' },
  { value: '\t', label: 'Tab' },
];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const FormatOption: React.FC<{
  option: (typeof FORMATS)[number];
  checked: boolean;
  onSelect: () => void;
}> = ({ option, checked, onSelect }) => {
  const inputId = useId();
  const descriptionId = useId();
  return (
    <div
      className={`flex items-start gap-2 p-2.5 rounded-control border ${
        checked ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      <input
        id={inputId}
        type="radio"
        name="export-format"
        checked={checked}
        onChange={onSelect}
        aria-describedby={descriptionId}
        className="mt-0.5 h-4 w-4 accent-brand"
      />
      <div>
        <label htmlFor={inputId} className="block text-xs font-semibold text-fg cursor-pointer">
          {option.label}
        </label>
        <span id={descriptionId} className="block text-2xs text-fg-muted">
          {option.description}
        </span>
      </div>
    </div>
  );
};

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  records,
  fields,
  dataset,
  activeColumnOrder,
}) => {
  const legendId = useId();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [includeBom, setIncludeBom] = useState(true);
  const [delimiter, setDelimiter] = useState<Delimiter>(',');
  const [prettyJson, setPrettyJson] = useState(true);
  const [jsonIndent, setJsonIndent] = useState(2);
  const [includeMetadata, setIncludeMetadata] = useState(false);
  const [includeValueDetails, setIncludeValueDetails] = useState(false);
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
  const autoFilename = generateExportFilename({ datasetName: customFilename.trim() || datasetName, format });
  const filename = customFilename.trim() ? `${customFilename.trim()}.${format}` : autoFilename;
  const columnCount = activeColumnOrder?.length ?? fields.length;
  const rows = records.length;
  const extras = [includeValueDetails && 'how numbers were read', includeMetadata && 'row details'].filter(Boolean);

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const details = includeValueDetails ? withValueDetails(records, fields) : null;
      const exportRecords = details?.records ?? records;
      const exportFields = details ? (details.fields ?? fields) : fields;
      const orderedColumns = details
        ? activeColumnOrder?.flatMap((column) => [
            column,
            ...details.detailColumns.filter((name) => name.startsWith(`${column} (`)),
          ])
        : activeColumnOrder;

      let result;
      if (format === 'csv') {
        // Chunks go straight into the Blob, so memory follows the chunk size, not the export size.
        const content = Array.from(
          recordsToCsvChunks(exportRecords, exportFields, { useBom: includeBom, delimiter, includeMetadata, orderedColumns })
        );
        result = await triggerDownload({ content, filename, mimeType: 'text/csv' });
      } else if (format === 'xlsx') {
        // The workbook writer is its own chunk, loaded only when someone exports to Excel.
        const { recordsToXlsx } = await import('@/core/export/xlsx');
        const content = recordsToXlsx(exportRecords, exportFields, { includeMetadata, orderedColumns });
        result = await triggerDownload({ content, filename, mimeType: XLSX_MIME });
      } else if (format === 'ndjson') {
        const content = Array.from(recordsToNdjsonChunks(exportRecords, exportFields, { includeMetadata, orderedColumns }));
        result = await triggerDownload({ content, filename, mimeType: 'application/x-ndjson' });
      } else {
        const content = Array.from(
          recordsToJsonChunks(exportRecords, exportFields, {
            pretty: prettyJson,
            indent: jsonIndent || 2,
            includeMetadata,
            orderedColumns,
          })
        );
        result = await triggerDownload({ content, filename, mimeType: 'application/json' });
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
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Export data"
      description={`${rows.toLocaleString('en-US')} ${rows === 1 ? 'row' : 'rows'} × ${columnCount} ${
        columnCount === 1 ? 'column' : 'columns'
      } will be exported${extras.length ? `, plus ${extras.join(' and ')}` : ''}.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            iconLeft={<Download aria-hidden="true" className="w-3.5 h-3.5" />}
            isLoading={isExporting}
            disabled={rows === 0}
            onClick={() => void handleExport()}
          >
            Download File
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-xs">
        {exportError && (
          <Banner
            tone="danger"
            title="The file was not saved"
            dataSafety="Your rows are still saved in PageHarvest."
            nextStep="Try again. If you closed the save window, press Download File again."
            details={exportError}
          >
            The browser did not start the download.
          </Banner>
        )}

        <fieldset aria-labelledby={legendId} className="flex flex-col gap-1.5">
          <span id={legendId} className="font-semibold text-fg-muted">
            Format
          </span>
          {FORMATS.map((option) => (
            <FormatOption
              key={option.value}
              option={option}
              checked={format === option.value}
              onSelect={() => setFormat(option.value)}
            />
          ))}
        </fieldset>

        {format === 'csv' && (
          <div className="flex flex-col gap-2">
            <Select
              label="Delimiter"
              value={delimiter}
              options={DELIMITERS}
              onChange={(e) => setDelimiter(e.target.value as Delimiter)}
              helperText="If Excel puts everything in one column, export again with Semicolon."
            />
            <label className="flex items-center gap-2 text-fg-muted cursor-pointer">
              <input
                type="checkbox"
                checked={includeBom}
                onChange={(e) => setIncludeBom(e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              Mark the file as UTF-8, so Excel shows accents and symbols correctly
            </label>
            <Banner tone="info">
              Cells that start like a formula, such as =, + or @, get a ' in front, so a spreadsheet will not run
              them. Numbers are written as they are.
            </Banner>
          </div>
        )}

        {format === 'xlsx' && (
          <Banner tone="info">
            Text is stored as text and numbers as numbers, so nothing in a cell runs as a formula.
          </Banner>
        )}

        {format === 'json' && (
          <label className="flex items-center gap-2 text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={prettyJson}
              onChange={(e) => setPrettyJson(e.target.checked)}
              className="w-4 h-4 accent-brand"
            />
            Indent the file so people can read it
          </label>
        )}

        <label className="flex items-start gap-2 text-fg-muted cursor-pointer">
          <input
            type="checkbox"
            checked={includeValueDetails}
            onChange={(e) => setIncludeValueDetails(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-brand"
          />
          <span>
            Add columns showing how each number was read
            <span className="block text-2xs text-fg-subtle">
              Its original text, whether it was clear or ambiguous, and its currency or range.
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2 text-fg-muted cursor-pointer">
          <input
            type="checkbox"
            checked={includeMetadata}
            onChange={(e) => setIncludeMetadata(e.target.checked)}
            className="w-4 h-4 accent-brand"
          />
          Include row details (row id, page, time collected)
        </label>

        <Input
          label="File name (optional)"
          placeholder={autoFilename}
          value={customFilename}
          onChange={(e) => setCustomFilename(e.target.value)}
          helperText={`Saved as ${filename}`}
        />
      </div>
    </Dialog>
  );
};
