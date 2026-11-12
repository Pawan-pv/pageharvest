import React, { useEffect, useRef, useState } from 'react';
import type { FieldPreviewResult } from '@/shared/contracts/message';
import type { FieldDefinition } from '@/types';

export interface PreviewTableProps {
  /** The columns that will be collected, in order. */
  columns: FieldDefinition[];
  /** Each item's text as it was read when the list was found. Shown when rows are not available. */
  samples: string[];
  /** Reads real rows from the page for these columns. Read-only (PREVIEW_FIELDS, ADR-030). */
  onPreview?: (columns: FieldDefinition[]) => Promise<FieldPreviewResult>;
  /** Told when the page layout changed and the list was found only by its backup. */
  onDriftChange?: (drifted: boolean) => void;
}

const ROWS = 3;
/** Waits for a pause in editing, so typing a name does not ask the page once per key. */
const DELAY_MS = 300;

type Rows = Extract<FieldPreviewResult, { ok: true }>;

function columnsKey(columns: FieldDefinition[]): string {
  return JSON.stringify(
    columns.map((c) => [c.id, c.name, c.selector, c.extractor, c.attributeName, c.regexPattern, c.regexGroup])
  );
}

/**
 * The first rows, as a plain table (ADR-039). It follows every rename and tick at once. When
 * the page cannot answer, it shows each item as it was read instead of an error: on this
 * screen the user only needs to recognise their list.
 */
export const PreviewTable: React.FC<PreviewTableProps> = ({ columns, samples, onPreview, onDriftChange }) => {
  const [rows, setRows] = useState<Rows | null>(null);
  const request = useRef(0);
  const latest = useRef({ columns, onPreview });
  const key = columnsKey(columns);
  const canPreview = Boolean(onPreview) && columns.length > 0;

  useEffect(() => {
    latest.current = { columns, onPreview };
  }, [columns, onPreview]);

  useEffect(() => {
    if (!canPreview) return undefined;
    const mine = ++request.current;
    const timer = setTimeout(() => {
      const { columns: current, onPreview: preview } = latest.current;
      if (!preview) return;
      void preview(current).then(
        (result) => {
          // An older answer that arrives late must not replace newer rows.
          if (mine === request.current) setRows(result.ok ? result : null);
        },
        () => {
          if (mine === request.current) setRows(null);
        }
      );
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, canPreview]);

  const live = canPreview ? rows : null;
  const drifted = live?.usedFallback === true;
  useEffect(() => {
    onDriftChange?.(drifted);
  }, [drifted, onDriftChange]);

  if (!live || live.rows.length === 0) {
    const items = samples.slice(0, ROWS);
    if (items.length === 0) return null;
    return (
      <ol aria-label="The first items" className="flex flex-col gap-1.5">
        {items.map((sample, index) => (
          <li
            key={index}
            className="px-3 py-2 rounded-control bg-surface-sunken border border-line text-body text-fg-muted break-words"
          >
            {sample || '(no words in this item)'}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="overflow-x-auto rounded-control border border-line">
      <table aria-label="The first rows" className="w-full text-body text-left">
        <thead className="bg-surface-muted">
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className="px-2.5 py-2 font-semibold text-fg whitespace-nowrap">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {live.rows.slice(0, ROWS).map((row, index) => (
            <tr key={index} className="border-t border-line-subtle">
              {columns.map((column) => {
                const value = row[column.name];
                const empty = value === null || value === undefined || value === '';
                return (
                  <td key={column.id} className="px-2.5 py-2 text-fg-muted max-w-[11rem] truncate">
                    {empty ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">empty</span>
                      </>
                    ) : (
                      String(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
