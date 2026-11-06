import React, { useId } from 'react';
import { Badge } from '@/components/common/Badge';
import type { FieldDefinition } from '@/types';
import { EXTRACTOR_LABELS } from './FieldEditorRow';

export interface FieldPreviewProps {
  /** The columns that will be collected, in order. */
  columns: FieldDefinition[];
  /** Text of the first items, as detection read it. */
  samples: string[];
}

const PREVIEW_ROWS = 3;

/**
 * What the table will look like. The columns follow every rename, reorder and choice at once.
 * Detection on this build reports each item's text but not its value per column, so the rows
 * show that text, labelled as a sample from detection, rather than guessed cells.
 */
export const FieldPreview: React.FC<FieldPreviewProps> = ({ columns, samples }) => {
  const headingId = useId();
  const rows = samples.slice(0, PREVIEW_ROWS);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="text-xs font-semibold text-fg">
          Preview
        </h3>
        <Badge variant="neutral" size="sm">
          Sample from detection
        </Badge>
      </div>

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
              {rows.map((sample, index) => (
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
        Rows show each item's full text. Each column gets its own value when the extraction runs.
      </p>
    </section>
  );
};
