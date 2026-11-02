import { FieldDefinition } from '@/types';
import { ListCandidate } from '@/shared/contracts/message';
import { generateCssSelector } from '@/utils/selector';
import { normalizeText } from '@/utils/dom';

/**
 * Extract Tables. A row is only a record if it has at least one data cell, so header rows
 * and section headings are never counted. Cell positions come from a grid that accounts
 * for rowspan and colspan, because counting cells in a row would shift the later columns.
 */
const MAX_TABLES = 8;
const MAX_SPAN = 1000;
const SAMPLE_ROWS = 3;

interface GridSlot {
  cell: HTMLTableCellElement;
  /** Set for columns after the first that a colspan covers. */
  spanned: boolean;
}

interface TableGrid {
  rowCount: number;
  slots: Array<Array<GridSlot | undefined>>;
  rowIndex: Map<Element, number>;
  columnCount: number;
}

const gridCache = new WeakMap<HTMLTableElement, TableGrid>();

function spanOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, MAX_SPAN) : 1;
}

function gridOf(table: HTMLTableElement): TableGrid {
  const rows = Array.from(table.rows);
  const cached = gridCache.get(table);
  if (cached && cached.rowCount === rows.length) return cached;

  const slots: TableGrid['slots'] = rows.map(() => []);
  const rowIndex = new Map<Element, number>();
  let columnCount = 0;

  rows.forEach((row, r) => {
    rowIndex.set(row, r);
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      while (slots[r][column]) column += 1;
      const rowSpan = spanOf(cell.rowSpan);
      const colSpan = spanOf(cell.colSpan);
      for (let down = 0; down < rowSpan && r + down < rows.length; down++) {
        for (let across = 0; across < colSpan; across++) {
          slots[r + down][column + across] = { cell, spanned: across > 0 };
        }
      }
      column += colSpan;
      columnCount = Math.max(columnCount, column);
    }
  });

  const grid: TableGrid = { rowCount: rows.length, slots, rowIndex, columnCount };
  gridCache.set(table, grid);
  return grid;
}

function cellText(cell: Element): string {
  return normalizeText((cell as HTMLElement).innerText || cell.textContent);
}

/**
 * The value of one column of one row. A rowspan cell repeats on each row it covers. A
 * colspan cell belongs to its first column, and the others it covers are empty.
 */
export function readTableCell(row: Element, columnIndex: number): string | null {
  const table = row.closest('table') as HTMLTableElement | null;
  if (!table) return null;
  const grid = gridOf(table);
  const r = grid.rowIndex.get(row);
  if (r === undefined) return null;
  const slot = grid.slots[r][columnIndex];
  if (!slot || slot.spanned) return null;
  return cellText(slot.cell) || null;
}

function isHeaderRow(row: HTMLTableRowElement): boolean {
  const cells = Array.from(row.cells);
  return cells.length > 0 && cells.every((cell) => cell.tagName === 'TH');
}

function findHeaderRow(table: HTMLTableElement): HTMLTableRowElement | null {
  const head = table.tHead;
  if (head && head.rows.length > 0) return head.rows[head.rows.length - 1];
  const first = table.rows[0];
  return first && isHeaderRow(first) ? first : null;
}

function columnNames(table: HTMLTableElement): string[] {
  const grid = gridOf(table);
  const header = findHeaderRow(table);
  const headerSlots = header ? grid.slots[grid.rowIndex.get(header) ?? 0] : [];
  const used = new Map<string, number>();

  return Array.from({ length: grid.columnCount }, (_, column) => {
    const slot = headerSlots[column];
    const text = slot ? cellText(slot.cell) : '';
    const base = text || `Column ${column + 1}`;
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    return seen === 1 ? base : `${base} ${seen}`;
  });
}

function dataRowsSelector(table: HTMLTableElement): string {
  return `${generateCssSelector(table)} > tbody > tr:has(> td)`;
}

function dataRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.tBodies).flatMap((body) =>
    Array.from(body.rows).filter((row) => Array.from(row.cells).some((cell) => cell.tagName === 'TD'))
  );
}

function isLayoutTable(table: HTMLTableElement, rows: HTMLTableRowElement[], columns: number): boolean {
  if (columns < 2 || rows.length === 0) return true;
  const hasHeader = findHeaderRow(table) !== null;
  if (!hasHeader && rows.length < 2) return true;
  const withNestedTable = rows.filter((row) => row.querySelector('table')).length;
  return withNestedTable > rows.length / 2;
}

function tableName(table: HTMLTableElement): string {
  const caption = table.caption ? cellText(table.caption) : '';
  if (caption) return caption;
  const label = table.getAttribute('aria-label')?.trim();
  if (label) return label;
  const previous = table.previousElementSibling;
  if (previous && /^H[1-6]$/.test(previous.tagName)) {
    const heading = cellText(previous);
    if (heading) return heading;
  }
  return 'Table';
}

export function detectTables(root: Document | Element = document): ListCandidate[] {
  const candidates: Array<ListCandidate & { size: number }> = [];

  for (const table of Array.from(root.querySelectorAll('table'))) {
    const rows = dataRows(table);
    const grid = gridOf(table);
    if (isLayoutTable(table, rows, grid.columnCount)) continue;

    const hasHeader = findHeaderRow(table) !== null;
    const containerSelector = dataRowsSelector(table);
    candidates.push({
      containerSelector,
      matchCount: rows.length,
      sampleSnippets: rows.slice(0, SAMPLE_ROWS).map((row) =>
        Array.from(row.cells).map(cellText).filter(Boolean).join(' | ').slice(0, 100)
      ),
      name: tableName(table),
      kind: 'table',
      credible: true,
      confidence: hasHeader ? 0.95 : 0.7,
      evidence: [
        hasHeader ? 'has column headers' : 'has no column headers',
        `${rows.length} data rows in ${grid.columnCount} columns`,
      ],
      suggestedFields: columnNames(table),
      size: rows.length * grid.columnCount,
    });
  }

  return candidates
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_TABLES)
    .map(({ size: _size, ...candidate }) => candidate);
}

/** One field per column, named after its header. */
export function tableFields(containerSelector: string, root: Document | Element = document): FieldDefinition[] {
  const firstRow = root.querySelector(containerSelector);
  const table = firstRow?.closest('table') as HTMLTableElement | null | undefined;
  if (!table) return [];

  const rows = dataRows(table);
  return columnNames(table).map((name, columnIndex) => {
    const filled = rows.filter((row) => readTableCell(row, columnIndex) !== null).length;
    const coverage = rows.length > 0 ? Math.round((filled / rows.length) * 100) / 100 : 0;
    return {
      id: `column_${columnIndex + 1}`,
      name,
      selector: ':scope',
      extractor: 'table_cell',
      columnIndex,
      required: false,
      discovery: {
        coverage,
        confidence: coverage,
        sampleSize: rows.length,
        occurrences: filled,
        suggested: filled > 0,
      },
    };
  });
}
