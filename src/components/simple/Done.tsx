import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Copy, Download, FileSpreadsheet, Plus, Table2 } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { SavedFileNotice } from '@/components/common/SavedFileNotice';
import { downloadRows, type QuickFormat } from '@/components/grid/download-rows';
import { recordsToCsv } from '@/core/export/exporter';
import type { ExtractionStats } from '@/hooks/useExtractionWorkflow';
import { isRecordMetadataKey } from '@/shared/contracts/record';
import type { Dataset, ExtractedRecord, FieldDefinition } from '@/types';
import { PlainTable } from './PlainTable';

export interface SimpleDoneProps {
  dataset: Dataset | null;
  records: ExtractedRecord[];
  fields: FieldDefinition[];
  /** The run that made these rows has just finished in this panel. False for saved data opened later. */
  justFinished: boolean;
  runSummary?: Pick<ExtractionStats, 'stopReason' | 'currentStep' | 'progressKind'> | null;
  /** Opens every row in the table, where cells can be changed. */
  onOpenTable: () => void;
  onNewExtraction: () => void;
}

const PREVIEW_ROWS = 5;

export function rowCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'}`;
}

function siteOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Why a finished run may not hold the whole list, in a sentence. Empty when it does. */
function limitNote(summary: SimpleDoneProps['runSummary']): string {
  if (!summary) return '';
  if (summary.stopReason === 'max_pages_reached') {
    return `It stopped after ${summary.currentStep} ${summary.currentStep === 1 ? 'page' : 'pages'}, the limit you chose. The list may have more.`;
  }
  if (summary.stopReason === 'max_scrolls_reached') {
    return 'It stopped at the number of scrolls you chose. The list may have more.';
  }
  return '';
}

/**
 * The end of the simple flow, and what a saved list looks like when it is opened again
 * (ADR-039): how many rows there are, one button that saves an Excel file, and the first
 * rows. The file's real name is shown once Chrome has written it. The full table, with
 * editing, is one click away; cleaning tools and other formats are under Advanced options.
 */
export const SimpleDone: React.FC<SimpleDoneProps> = ({
  dataset,
  records,
  fields,
  justFinished,
  runSummary,
  onOpenTable,
  onNewExtraction,
}) => {
  const [busy, setBusy] = useState<QuickFormat | null>(null);
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const [startedWithoutId, setStartedWithoutId] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    []
  );

  const columns =
    fields.length > 0
      ? fields.map((field) => field.name)
      : Object.keys(records[0] ?? {}).filter((key) => !isRecordMetadataKey(key));
  const total = records.length;
  const site = siteOf(dataset?.url);
  const note = justFinished ? limitNote(runSummary) : '';

  const save = async (format: QuickFormat) => {
    setBusy(format);
    setProblem(null);
    setDownloadId(null);
    setStartedWithoutId(false);
    const result = await downloadRows(records, fields.length > 0 ? fields : undefined, { format, name: dataset?.name });
    setBusy(null);
    if (!result.success) {
      setProblem(result.error ?? 'The download did not start.');
    } else if (typeof result.downloadId === 'number') {
      setDownloadId(result.downloadId);
    } else {
      setStartedWithoutId(true);
    }
  };

  const copy = async () => {
    setProblem(null);
    try {
      // Tabs between cells, so a paste lands in separate spreadsheet cells.
      const text = recordsToCsv(records, fields.length > 0 ? fields : undefined, {
        includeMetadata: false,
        useBom: false,
        delimiter: '\t',
      });
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        copiedTimer.current = null;
        setCopied(false);
      }, 2500);
    } catch (error: unknown) {
      setProblem(`The table was not copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (total === 0) {
    return (
      <div className="flex flex-col gap-3 p-4 text-left">
        <Banner
          tone="warning"
          title="No rows were collected"
          nextStep='Go back to the page, wait until it has finished loading, and try again. If the same thing happens, use "Pick one item myself".'
        >
          PageHarvest found the list, but could not read any rows from it.
        </Banner>
        <div>
          <Button onClick={onNewExtraction}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      {justFinished ? (
        <div className="flex items-start gap-2.5">
          <CheckCircle2 aria-hidden="true" className="w-6 h-6 mt-0.5 shrink-0 text-brand-fg" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg leading-snug">Done. {rowCount(total)} collected</h2>
            <p className="text-body text-fg-muted mt-0.5">
              {site ? `From ${site}. ` : ''}They are saved in My data.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg leading-snug break-words">{dataset?.name ?? 'Your rows'}</h2>
          <p className="text-body text-fg-muted mt-0.5">
            {rowCount(total)}
            {site ? ` from ${site}` : ''}
            {dataset ? `, collected on ${new Date(dataset.createdAt).toLocaleDateString()}` : ''}
          </p>
        </div>
      )}

      {note && <Banner tone="info">{note}</Banner>}

      <Button
        size="lg"
        className="w-full justify-center font-semibold"
        iconLeft={<FileSpreadsheet aria-hidden="true" className="w-5 h-5" />}
        isLoading={busy === 'xlsx'}
        disabled={busy !== null}
        onClick={() => void save('xlsx')}
      >
        Download for Excel
      </Button>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          iconLeft={<Download aria-hidden="true" className="w-3.5 h-3.5" />}
          isLoading={busy === 'csv'}
          disabled={busy !== null}
          onClick={() => void save('csv')}
        >
          Download a CSV file
        </Button>
        <Button
          variant="outline"
          size="sm"
          iconLeft={
            copied ? (
              <Check aria-hidden="true" className="w-3.5 h-3.5 text-brand-fg" />
            ) : (
              <Copy aria-hidden="true" className="w-3.5 h-3.5" />
            )
          }
          onClick={() => void copy()}
        >
          {copied ? 'Copied. Paste it into a spreadsheet' : 'Copy the table'}
        </Button>
      </div>

      {downloadId !== null && <SavedFileNotice downloadId={downloadId} onDismiss={() => setDownloadId(null)} />}
      {startedWithoutId && (
        <Banner tone="info" onDismiss={() => setStartedWithoutId(false)}>
          The download has started. Look in your Downloads folder.
        </Banner>
      )}
      {problem && (
        <Banner
          tone="danger"
          title="That did not work"
          dataSafety="Your rows are still saved in PageHarvest."
          nextStep="Try again."
          details={problem}
          onDismiss={() => setProblem(null)}
        />
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-fg">The first rows</h3>
        <PlainTable label="The first rows" columns={columns} rows={records.slice(0, PREVIEW_ROWS)} />
        {total > PREVIEW_ROWS && (
          <p className="text-body text-fg-muted">
            Showing {PREVIEW_ROWS} of {rowCount(total)}. The file has all of them.
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          iconLeft={<Table2 aria-hidden="true" className="w-3.5 h-3.5" />}
          onClick={onOpenTable}
        >
          See and change all rows
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Plus aria-hidden="true" className="w-3.5 h-3.5" />}
          onClick={onNewExtraction}
        >
          Get another list
        </Button>
      </div>
    </div>
  );
};
