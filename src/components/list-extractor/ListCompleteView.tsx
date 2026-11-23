import React, { useMemo, useState } from 'react';
import { Bookmark, Check, Copy, Download, ExternalLink, FileSpreadsheet } from 'lucide-react';
import { downloadRows, type QuickFormat } from '@/components/grid/download-rows';
import { SavedFileNotice } from '@/components/common/SavedFileNotice';
import { openWorkbench } from '@/platform/workbench';
import { recordsToCsv } from '@/core/export/exporter';
import { isRecordMetadataKey } from '@/shared/contracts/record';
import type { Dataset, ExtractedRecord, FieldDefinition } from '@/types';
import type { ExtractionStats } from '@/hooks/useExtractionWorkflow';

export interface ListCompleteViewProps {
  dataset: Dataset | null;
  records: ExtractedRecord[];
  fields: FieldDefinition[];
  runSummary?: Pick<ExtractionStats, 'elapsedSeconds' | 'stopReason' | 'currentStep'> | null;
  onDone: () => void;
  onSaveRecipe?: () => Promise<void> | void;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function extractImage(record: ExtractedRecord): string | null {
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (/^https?:\/\/.+\.(jpg|jpeg|png|webp|avif|gif)(\?.*)?$/i.test(val)) {
        return val;
      }
      if (/(image|img|src|thumbnail|photo|picture)/i.test(key) && /^https?:\/\//i.test(val)) {
        return val;
      }
    }
  }
  return null;
}

export const ListCompleteView: React.FC<ListCompleteViewProps> = ({
  dataset,
  records,
  fields,
  runSummary,
  onDone,
  onSaveRecipe,
}) => {
  const [copiedTsv, setCopiedTsv] = useState(false);
  const [savedRecipe, setSavedRecipe] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<QuickFormat | null>(null);
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const [startedWithoutId, setStartedWithoutId] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const totalCount = records.length;
  const elapsed = runSummary?.elapsedSeconds ?? 0;
  const columnsCount =
    fields.length > 0
      ? fields.length
      : Object.keys(records[0] ?? {}).filter((k) => !isRecordMetadataKey(k)).length;

  const displayColumns = useMemo(() => {
    if (fields.length > 0) return fields.map((f) => f.name);
    return Object.keys(records[0] ?? {}).filter((k) => !isRecordMetadataKey(k));
  }, [fields, records]);

  // Extract up to 8 images for 4x2 mosaic grid
  const mosaicImages = useMemo(() => {
    const urls: string[] = [];
    for (const record of records) {
      const url = extractImage(record);
      if (url && !urls.includes(url)) {
        urls.push(url);
        if (urls.length >= 8) break;
      }
    }
    return urls;
  }, [records]);

  const handleOpenWorkbench = () => {
    if (dataset?.id) {
      void openWorkbench({ datasetId: dataset.id });
    } else {
      void openWorkbench();
    }
  };

  const handleDownload = async (format: QuickFormat) => {
    setDownloadingFormat(format);
    setProblem(null);
    setDownloadId(null);
    setStartedWithoutId(false);
    try {
      const result = await downloadRows(records, fields.length > 0 ? fields : undefined, {
        format,
        name: dataset?.name,
      });
      if (!result.success) {
        setProblem(result.error ?? 'The download did not start.');
      } else if (typeof result.downloadId === 'number') {
        setDownloadId(result.downloadId);
      } else {
        setStartedWithoutId(true);
      }
    } catch (e: unknown) {
      setProblem(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleCopyTsv = async () => {
    try {
      const tsv = recordsToCsv(records, fields.length > 0 ? fields : undefined, {
        includeMetadata: false,
        useBom: false,
        delimiter: '\t',
      });
      await navigator.clipboard.writeText(tsv);
      setCopiedTsv(true);
      setTimeout(() => setCopiedTsv(false), 2000);
    } catch (e) {
      console.error('Failed to copy TSV', e);
    }
  };

  const handleBookmarkRecipe = async () => {
    if (onSaveRecipe) {
      try {
        await onSaveRecipe();
        setSavedRecipe(true);
        setTimeout(() => setSavedRecipe(false), 2500);
      } catch (e) {
        console.error('Failed to save recipe', e);
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-left min-h-[480px]">
      {/* Top Hero Section: Draw-in Checkmark & Count */}
      <div className="flex flex-col items-center justify-center text-center pt-2">
        {/* Animated Draw-in Checkmark inside glowing emerald ring */}
        <div className="relative flex h-16 w-16 items-center justify-center mb-3">
          <div className="absolute inset-0 rounded-full bg-[#00E599]/20 blur-md" />
          <svg className="h-16 w-16" viewBox="0 0 52 52">
            <circle
              cx="26"
              cy="26"
              r="24"
              fill="none"
              stroke="#00E599"
              strokeWidth="3"
              className="opacity-80"
            />
            <path
              fill="none"
              stroke="#00E599"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ph-check-draw"
              d="M14 27l8 8 16-16"
            />
          </svg>
        </div>

        <h2 className="text-sm font-bold text-fg uppercase tracking-wider mb-1">
          Extraction complete
        </h2>

        {/* Giant Emerald Tabular Counter */}
        <div className="text-5xl font-black text-[#00E599] tracking-tight tabular-nums">
          {totalCount.toLocaleString('en-US')}
        </div>
        <span className="text-xs font-bold tracking-widest text-[#00E599]/80 uppercase mt-0.5">
          ITEMS EXTRACTED
        </span>
      </div>

      {/* 4x2 Visual Mosaic Grid or Compact Preview Table Snippet */}
      {mosaicImages.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-3xs font-semibold text-fg-subtle uppercase tracking-wider">
            Captured Gallery ({mosaicImages.length})
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {mosaicImages.map((src, i) => (
              <div
                key={i}
                className="aspect-square overflow-hidden rounded-lg border border-[#00E599]/20 bg-[#10141D] ph-pop-in"
              >
                <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-3xs font-semibold text-fg-subtle uppercase tracking-wider">
            Preview Snippet
          </span>
          <div className="overflow-x-auto rounded-xl border border-line bg-[#10141D]">
            <table className="w-full text-left text-2xs">
              <thead className="border-b border-line-subtle bg-surface-sunken text-fg-subtle">
                <tr>
                  {displayColumns.slice(0, 3).map((col, idx) => (
                    <th key={idx} className="px-2.5 py-1.5 font-semibold truncate max-w-[100px]">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle text-fg">
                {records.slice(0, 3).map((rec, rIdx) => (
                  <tr key={rIdx}>
                    {displayColumns.slice(0, 3).map((col, cIdx) => (
                      <td key={cIdx} className="px-2.5 py-1.5 truncate max-w-[100px]">
                        {String(rec[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3-Column Summary Card */}
      <div className="grid grid-cols-3 divide-x divide-line-subtle rounded-2xl border border-line bg-[#10141D] p-3 text-center shadow-sm">
        <div className="flex flex-col items-center">
          <span className="text-3xs font-semibold tracking-wider text-fg-subtle uppercase">
            ITEMS
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {totalCount.toLocaleString('en-US')}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-3xs font-semibold tracking-wider text-fg-subtle uppercase">
            TIME
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {formatElapsed(elapsed)}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-3xs font-semibold tracking-wider text-fg-subtle uppercase">
            COLUMNS
          </span>
          <span className="text-sm font-bold text-[#00E599] tabular-nums mt-0.5">
            {columnsCount}
          </span>
        </div>
      </div>

      {/* Bottom Action Stack */}
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        {/* High-contrast glowing emerald primary CTA */}
        <button
          type="button"
          onClick={handleOpenWorkbench}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00E599] py-3 px-4 font-bold text-sm text-[#080B10] shadow-[0_0_24px_rgba(0,229,153,0.35)] transition-all duration-200 hover:bg-[#00E599]/90 hover:shadow-[0_0_32px_rgba(0,229,153,0.5)] active:scale-[0.99] cursor-pointer"
        >
          <span>View data &amp; export</span>
          <ExternalLink className="h-4 w-4" />
        </button>

        {/* Quick One-Click Export Pills */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleDownload('csv')}
            disabled={downloadingFormat === 'csv'}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-[#10141D] py-1.5 px-2 text-2xs font-semibold text-fg transition-colors hover:border-[#00E599]/30 hover:text-[#00E599] disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3 w-3" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={() => handleDownload('xlsx')}
            disabled={downloadingFormat === 'xlsx'}
            title="Download for Excel"
            aria-label="Download for Excel"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-[#10141D] py-1.5 px-2 text-2xs font-semibold text-fg transition-colors hover:border-[#00E599]/30 hover:text-[#00E599] disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="h-3 w-3" />
            <span>XLSX</span>
          </button>

          <button
            type="button"
            onClick={handleCopyTsv}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-[#10141D] py-1.5 px-2 text-2xs font-semibold text-fg transition-colors hover:border-[#00E599]/30 hover:text-[#00E599] cursor-pointer"
          >
            {copiedTsv ? (
              <>
                <Check className="h-3 w-3 text-[#00E599]" />
                <span className="text-[#00E599]">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy TSV</span>
              </>
            )}
          </button>
        </div>

        {/* Saved file notice when download finishes */}
        {downloadId !== null && (
          <SavedFileNotice
            downloadId={downloadId}
            onDismiss={() => setDownloadId(null)}
            className="mt-1"
          />
        )}

        {startedWithoutId && (
          <div className="rounded-xl border border-[#00E599]/30 bg-[#00E599]/10 p-2 text-2xs text-[#00E599]">
            The download has started. Look in your Downloads folder.
          </div>
        )}

        {problem && (
          <div className="rounded-xl border border-danger-line bg-danger-soft p-2 text-2xs text-danger-fg">
            {problem}
          </div>
        )}

        {/* Utility Row: Done + Bookmark button */}
        <div className="flex items-center gap-2 w-full pt-1">
          <button
            type="button"
            onClick={onDone}
            className="flex-1 flex items-center justify-center rounded-xl border border-line bg-[#10141D] py-2 px-4 text-xs font-semibold text-fg transition-colors hover:border-line-strong hover:text-fg active:scale-[0.99] cursor-pointer"
          >
            Done
          </button>

          <button
            type="button"
            onClick={handleBookmarkRecipe}
            title="Save as Recipe"
            aria-label="Save as Recipe"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all cursor-pointer ${
              savedRecipe
                ? 'border-[#00E599] bg-[#00E599]/20 text-[#00E599]'
                : 'border-line bg-[#10141D] text-fg-subtle hover:border-[#00E599]/30 hover:text-[#00E599]'
            }`}
          >
            {savedRecipe ? (
              <Check className="h-4 w-4" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
