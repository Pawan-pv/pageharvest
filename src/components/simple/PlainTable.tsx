import React from 'react';

export interface PlainTableProps {
  /** Read out as the table's name. */
  label: string;
  /** Column names, in the order they will be in the spreadsheet. */
  columns: string[];
  /** One object per row, keyed by column name. */
  rows: Record<string, unknown>[];
}

/**
 * Rows and columns as a spreadsheet user expects them (ADR-039): a header, a few rows, and a
 * dash where a cell is empty. Long values are cut short; the full value is in the file.
 */
export const PlainTable: React.FC<PlainTableProps> = ({ label, columns, rows }) => (
  <div className="overflow-x-auto rounded-control border border-line">
    <table aria-label={label} className="w-full text-body text-left">
      <thead className="bg-surface-muted">
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col" className="px-2.5 py-2 font-semibold text-fg whitespace-nowrap">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-t border-line-subtle">
            {columns.map((column) => {
              const value = row[column];
              const empty = value === null || value === undefined || value === '';
              return (
                <td key={column} className="px-2.5 py-2 text-fg-muted max-w-[11rem] truncate">
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
