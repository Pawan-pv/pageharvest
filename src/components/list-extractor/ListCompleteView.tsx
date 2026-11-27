import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const isMountedRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

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
      if (!isMountedRef.current) return;
      if (!result.success) {
        setProblem(result.error ?? 'The download did not start.');
      } else if (typeof result.downloadId === 'number') {
        setDownloadId(result.downloadId);
      } else {
        setStartedWithoutId(true);
      }
    } catch (e: unknown) {
      if (!isMountedRef.current) return;
      setProblem(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      if (isMountedRef.current) {
        setDownloadingFormat(null);
      }
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
      if (!isMountedRef.current) return;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopiedTsv(true);
      copyTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) setCopiedTsv(false);
      }, 2000);
    } catch (e) {
      console.error('Failed to copy TSV', e);
    }
  };

  const handleBookmarkRecipe = async () => {
    if (onSaveRecipe) {
      try {
        await onSaveRecipe();
        if (!isMountedRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        setSavedRecipe(true);
        saveTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setSavedRecipe(false);
        }, 2500);
      } catch (e) {
        console.error('Failed to save recipe', e);
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-left min-h-[480px]">
      {/* Top Hero Section: Draw-in Checkmark with 6-spark SVG burst & Count */}
      <div className="flex flex-col items-center justify-center text-center pt-2">
        {/* Animated Draw-in Checkmark + one-shot 6-spark burst inside glowing emerald ring */}
        <div className="relative flex h-16 w-16 items-center justify-center mb-3">
          <div className="absolute inset-0 rounded-full bg-brand/20 blur-md" aria-hidden="true" />
          <svg className="h-16 w-16" viewBox="0 0 64 64" aria-hidden="true">
            {[0, 60, 120, 180, 240, 300].map((deg, idx) => (
              <g key={deg} transform={`translate(32 32) rotate(${deg})`}>
                <line
                  x1="0"
                  y1="-23"
                  x2="0"
                  y2="-28"
                  stroke={idx % 2 === 0 ? 'rgb(var(--ph-brand))' : 'rgb(var(--ph-tool-teal))'}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="ph-spark-burst motion-reduce:animate-none"
                  style={{ animationDelay: '160ms' }}
                />
              </g>
            ))}
            <circle
              cx="32"
              cy="32"
              r="22"
              fill="none"
              stroke="rgb(var(--ph-brand))"
              strokeWidth="3"
              className="opacity-80"
            />
            <path
              fill="none"
              stroke="rgb(var(--ph-brand))"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ph-check-draw motion-reduce:animate-none"
              d="M21 33l7 7 15-15"
            />
          </svg>
        </div>

        <h2 className="text-sm font-bold text-fg uppercase tracking-wider mb-1">
          Extraction complete
        </h2>

        {/* Giant Emerald Tabular Counter */}
        <div className="text-5xl font-black text-brand-fg tracking-tight tabular-nums">
          {totalCount.toLocaleString('en-US')}
        </div>
        <span className="text-xs font-bold tracking-widest text-brand-fg uppercase mt-0.5">
          ITEMS EXTRACTED
        </span>
      </div>

      {/* Compact Preview: latest 5 records as structured text rows */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider">
          Preview Snippet
        </span>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface ph-card-elevated">
          <table className="w-full text-left text-2xs" aria-label="Preview Snippet">
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
              {records.slice(0, 5).map((rec, rIdx) => (
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

      {/* 3-Column Summary Card */}
      <div className="grid grid-cols-3 divide-x divide-line-subtle rounded-2xl border border-line bg-surface p-3 text-center ph-card-elevated">
        <div className="flex flex-col items-center">
          <span className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
            ITEMS
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {totalCount.toLocaleString('en-US')}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
            TIME
          </span>
          <span className="text-sm font-bold text-fg tabular-nums mt-0.5">
            {formatElapsed(elapsed)}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
            COLUMNS
          </span>
          <span className="text-sm font-bold text-brand-fg tabular-nums mt-0.5">
            {columnsCount}
          </span>
        </div>
      </div>

      {/* Bottom Action Stack */}
      <div className="mt-auto flex flex-col gap-2.5 pt-2">
        {/* High-contrast glowing emerald primary CTA with single-pass sheen */}
        <button
          type="button"
          onClick={handleOpenWorkbench}
          className="ph-cta-sheen motion-reduce:animate-none flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 px-4 font-bold text-sm text-on-strong shadow-glow-emerald transition-all duration-200 hover:bg-brand-hover active:scale-[0.99] cursor-pointer"
        >
          <span>View data &amp; export</span>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Quick One-Click Export Pills */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleDownload('csv')}
            disabled={downloadingFormat === 'csv'}
            className="flex min-h-8 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface ph-card-elevated py-1.5 px-2 text-2xs font-semibold text-fg transition-colors hover:border-brand/40 hover:text-brand-fg disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={() => handleDownload('xlsx')}
            disabled={downloadingFormat === 'xlsx'}
            title="Download for Excel"
            aria-label="Download for Excel"
            className="flex min-h-8 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface ph-card-elevated py-1.5 px-2 text-2xs font-semibold text-fg transition-colors hover:border-brand/40 hover:text-brand-fg disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />
            <span>XLSX</span>
          </button>

          <button
            type="button"
            onClick={handleCopyTsv}
            className="flex min-h-8 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface ph-card-elevated py-1.5 px-2 text-2xs font-semibold text-fg transition-colors hover:border-brand/40 hover:text-brand-fg cursor-pointer"
          >
            {copiedTsv ? (
              <>
                <Check className="h-3 w-3 text-brand-fg" aria-hidden="true" />
                <span className="text-brand-fg">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" aria-hidden="true" />
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
          <div className="rounded-xl border border-brand-line bg-brand-soft p-2 text-2xs text-brand-fg">
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
            className="flex-1 flex items-center justify-center rounded-xl border border-line bg-surface py-2 px-4 text-xs font-semibold text-fg transition-colors hover:border-line-strong hover:text-fg active:scale-[0.99] cursor-pointer"
          >
            Done
          </button>

          <button
            type="button"
            onClick={handleBookmarkRecipe}
            title="Save as Recipe"
            aria-label="Save as Recipe"
            className={`flex h-10 shrink-0 items-center justify-center rounded-xl border transition-all cursor-pointer ${
              savedRecipe
                ? 'gap-1.5 border-brand bg-brand-soft px-3 text-xs font-semibold text-brand-fg'
                : 'w-10 border-line bg-surface text-fg-subtle hover:border-brand/40 hover:text-brand-fg'
            }`}
          >
            {savedRecipe ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" />
                <span>Saved!</span>
              </>
            ) : (
              <Bookmark className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
