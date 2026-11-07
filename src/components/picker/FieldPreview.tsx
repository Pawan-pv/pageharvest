import React, { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import type { FieldPreviewResult } from '@/shared/contracts/message';
import type { FieldDefinition } from '@/types';
import { EXTRACTOR_LABELS } from './FieldEditorRow';

export interface FieldPreviewProps {
  /** The columns that will be collected, in order. */
  columns: FieldDefinition[];
  /** Text of the first items, as detection read it. Shown when no live preview is available. */
  samples: string[];
  /** Reads real rows from the page for these columns (PREVIEW_FIELDS, ADR-030). */
  onPreview?: (columns: FieldDefinition[]) => Promise<FieldPreviewResult>;
  /** Told whether the list is found only with its backup anchor, so a run must wait. */
  onDriftChange?: (drifted: boolean) => void;
  /** Opens the picker, so the user can choose the list again on a changed page. */
  onPickListAgain?: () => void;
}

const PREVIEW_ROWS = 3;
/** Waits for a pause in editing, so typing a name does not send a request per key. */
const PREVIEW_DELAY_MS = 300;

type LiveState =
  | { status: 'idle' }
  | { status: 'loading'; previous?: Extract<FieldPreviewResult, { ok: true }> }
  | { status: 'done'; result: FieldPreviewResult };

/** What the columns read on the page; changes when any of them does. */
function columnsKey(columns: FieldDefinition[]): string {
  return JSON.stringify(
    columns.map((c) => [c.id, c.name, c.selector, c.extractor, c.attributeName, c.regexPattern, c.regexGroup])
  );
}

function formatCell(value: string | number | boolean | null | undefined): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">empty</span>
      </>
    );
  }
  return String(value);
}

/**
 * What the table will look like. Columns follow every rename, reorder and choice at once.
 * With a live preview the rows are real values read from the page; otherwise, or when the
 * page cannot answer, rows show each item's text from detection, labelled as such.
 */
export const FieldPreview: React.FC<FieldPreviewProps> = ({ columns, samples, onPreview, onDriftChange, onPickListAgain }) => {
  const headingId = useId();
  const [live, setLive] = useState<LiveState>({ status: 'idle' });
  const requestRef = useRef(0);
  const key = columnsKey(columns);
  const columnsRef = useRef(columns);
  // Only the columns decide when to ask again; a new function identity from the parent does not.
  const onPreviewRef = useRef(onPreview);
  const hasPreview = Boolean(onPreview);

  // Runs before the request effect below, so a request always reads the latest columns.
  useEffect(() => {
    columnsRef.current = columns;
    onPreviewRef.current = onPreview;
  }, [columns, onPreview]);

  useEffect(() => {
    if (!hasPreview || columnsRef.current.length === 0) return undefined;
    const request = ++requestRef.current;
    setLive((current) => ({
      status: 'loading',
      previous: current.status === 'done' && current.result.ok ? current.result : current.status === 'loading' ? current.previous : undefined,
    }));
    const timer = setTimeout(() => {
      const preview = onPreviewRef.current;
      if (!preview) return;
      void preview(columnsRef.current).then((result) => {
        // An older request that finishes late must not replace newer rows.
        if (request === requestRef.current) setLive({ status: 'done', result });
      });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, hasPreview]);

  const liveRows =
    live.status === 'done' && live.result.ok ? live.result : live.status === 'loading' ? live.previous : undefined;
  const failure = live.status === 'done' && !live.result.ok ? live.result : undefined;
  const showLive = Boolean(onPreview) && liveRows !== undefined && !failure;
  // While a refresh loads, the last answer still stands, so Start does not flicker back on.
  const drifted =
    (live.status === 'done' && live.result.ok && live.result.usedFallback) ||
    (live.status === 'loading' && live.previous?.usedFallback === true);

  useEffect(() => {
    onDriftChange?.(drifted);
  }, [drifted, onDriftChange]);
  const rows = samples.slice(0, PREVIEW_ROWS);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="text-xs font-semibold text-fg">
          Preview
        </h3>
        <Badge variant={drifted ? 'warning' : showLive ? 'brand' : 'neutral'} size="sm">
          {drifted ? 'Found with a backup' : showLive ? 'Live from the page' : 'Sample from detection'}
        </Badge>
        <span aria-live="polite" className="text-2xs text-fg-subtle">
          {live.status === 'loading' ? 'Updating…' : ''}
        </span>
      </div>

      {failure && <ErrorBanner error={{ code: failure.code, message: failure.message }} />}

      {drifted && (
        <Banner
          tone="warning"
          title="Matched using a backup"
          actions={
            onPickListAgain && (
              <Button size="sm" variant="outline" onClick={onPickListAgain}>
                Pick the list again
              </Button>
            )
          }
        >
          The page layout changed. A run wouldn't find this list yet. Pick the list again to continue.
        </Banner>
      )}

      {columns.length === 0 ? (
        <p className="text-2xs text-fg-subtle">Choose at least one column to see the preview.</p>
      ) : (
        <div className="overflow-x-auto rounded-control border border-line">
          <table className="w-full text-2xs text-left">
            <thead className="bg-surface-muted">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    title={EXTRACTOR_LABELS[column.extractor]}
                    className="px-2 py-1.5 font-semibold text-fg whitespace-nowrap"
                  >
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showLive && liveRows
                ? liveRows.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                    <tr key={index} className="border-t border-line-subtle">
                      {columns.map((column) => (
                        <td key={column.id} className="px-2 py-1.5 text-fg-muted max-w-[10rem] truncate">
                          {formatCell(row[column.name])}
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((sample, index) => (
                    <tr key={index} className="border-t border-line-subtle">
                      <td colSpan={columns.length} className="px-2 py-1.5 text-fg-muted truncate max-w-0">
                        {sample || '(no text in this item)'}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-2xs text-fg-subtle">
        {showLive && liveRows
          ? `First ${Math.min(PREVIEW_ROWS, liveRows.rows.length)} of ${liveRows.matchCount} items, read from the page just now. Nothing is saved until you run the extraction.`
          : "Rows show each item's full text. Each column gets its own value when the extraction runs."}
      </p>
    </section>
  );
};
