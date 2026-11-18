import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SimpleColumns } from '@/components/simple/Columns';
import {
  SIMPLE_DEFAULT_PAGES,
  SIMPLE_DEFAULT_SCROLLS,
  SIMPLE_MAX_PAGES,
  answerFor,
  listContinues,
  settingsForAnswer,
  simpleStartingPagination,
} from '@/components/simple/more-pages';
import type { DetectedList } from '@/hooks/useExtractionWorkflow';
import { PaginationConfigSchema } from '@/shared/contracts/pagination';
import type { ExtractionPaginationConfig, FieldDefinition } from '@/types';

const discovery = (sampleValue: string) => ({
  type: 'text' as const,
  coverage: 1,
  confidence: 0.9,
  sampleSize: 12,
  occurrences: 20,
  suggested: true,
  sampleValue,
});

const FIELDS: FieldDefinition[] = [
  { id: 'f_title', name: 'Title', selector: 'h3 a', extractor: 'attribute', attributeName: 'title', discovery: discovery('A Light in the Attic') },
  { id: 'f_price', name: 'Price', selector: '.price_color', extractor: 'number', discovery: discovery('51.77') },
  { id: 'f_action', name: 'Action', selector: 'button', extractor: 'text', discovery: { ...discovery('Add to basket'), suggested: false } },
];

const LIST: DetectedList = { containerSelector: 'article.product_pod', matchCount: 20, sampleSnippets: [] };

const BASE: ExtractionPaginationConfig = {
  type: 'none',
  maxPages: 5,
  delayMs: 1500,
  scrollCount: 10,
  scrollDelayMs: 1500,
  startPage: 1,
  pageIncrement: 1,
};

function renderColumns(props: Partial<React.ComponentProps<typeof SimpleColumns>> = {}) {
  const handlers = {
    onToggleField: vi.fn(),
    onRenameField: vi.fn(),
    onPaginationChange: vi.fn(),
    onBack: vi.fn(),
    onStart: vi.fn(),
  };
  const view = render(
    <SimpleColumns
      detectedList={LIST}
      fields={FIELDS}
      selectedFieldIds={new Set(['f_title', 'f_price'])}
      pagination={BASE}
      {...handlers}
      {...props}
    />
  );
  return { ...handlers, ...view };
}

describe('More pages in simple mode: one question, written into the usual settings', () => {
  it('follows the list by default when the page shows a way to more of it', () => {
    expect(listContinues('next')).toBe(true);
    expect(listContinues('load_more')).toBe(true);
    expect(listContinues('none')).toBe(false);
    expect(listContinues(undefined)).toBe(false);

    expect(simpleStartingPagination('next')).toMatchObject({ type: 'next_button', maxPages: SIMPLE_DEFAULT_PAGES });
    expect(simpleStartingPagination('load_more')).toMatchObject({ type: 'next_button', maxPages: SIMPLE_DEFAULT_PAGES });
    expect(simpleStartingPagination('none')).toMatchObject({ type: 'none' });
    expect(simpleStartingPagination(undefined)).toMatchObject({ type: 'none' });
  });

  it('defaults to 5 pages, not the 20 that Advanced options starts from', () => {
    expect(SIMPLE_DEFAULT_PAGES).toBe(5);
    expect(SIMPLE_MAX_PAGES).toBe(50);
    expect(simpleStartingPagination('next').maxPages).toBe(5);
    expect(simpleStartingPagination('none').scrollCount).toBe(SIMPLE_DEFAULT_SCROLLS);
  });

  it('clears the settings a simple-mode user cannot see, so none of them shapes the job', () => {
    const start = simpleStartingPagination('next');
    expect(start).toHaveProperty('nextButtonSelector', undefined);
    expect(start).toHaveProperty('urlTemplate', undefined);
    expect(start).toHaveProperty('maxRecords', undefined);
  });

  it('keeps the number of pages between 1 and 50', () => {
    expect(settingsForAnswer('next', 0)).toEqual({ type: 'next_button', maxPages: 1 });
    expect(settingsForAnswer('next', 80)).toEqual({ type: 'next_button', maxPages: 50 });
    expect(settingsForAnswer('next', 12.4)).toEqual({ type: 'next_button', maxPages: 12 });
    expect(settingsForAnswer('next')).toEqual({ type: 'next_button', maxPages: 5 });
    expect(settingsForAnswer('scroll', 999)).toEqual({ type: 'infinite_scroll', scrollCount: 50 });
    expect(settingsForAnswer('scroll')).toEqual({ type: 'infinite_scroll', scrollCount: 10 });
    expect(settingsForAnswer('no', 7)).toEqual({ type: 'none' });
  });

  it('always produces settings the pagination contract accepts', () => {
    for (const hint of ['next', 'load_more', 'none', undefined] as const) {
      expect(PaginationConfigSchema.safeParse({ ...BASE, ...simpleStartingPagination(hint) }).success).toBe(true);
    }
    for (const count of [-3, 0, 1, 50, 51, 10_000]) {
      expect(PaginationConfigSchema.safeParse({ ...BASE, ...settingsForAnswer('next', count) }).success).toBe(true);
      expect(PaginationConfigSchema.safeParse({ ...BASE, ...settingsForAnswer('scroll', count) }).success).toBe(true);
    }
  });

  it('reads the answer back from the settings', () => {
    expect(answerFor({ type: 'none' })).toBe('no');
    expect(answerFor({ type: 'next_button' })).toBe('next');
    expect(answerFor({ type: 'url_template' })).toBe('next');
    expect(answerFor({ type: 'infinite_scroll' })).toBe('scroll');
  });
});

describe('Simple mode: "Check your columns" (T1, step 3)', () => {
  it('lists every column with an example from the page, in plain words', () => {
    const { container } = renderColumns();
    expect(screen.getByRole('heading', { name: 'Check your columns' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name of the column Title' })).toHaveValue('Title');
    expect(screen.getByText('For example: A Light in the Attic')).toBeInTheDocument();
    expect(screen.getByText('For example: 51.77')).toBeInTheDocument();
    // What a column reads, and where on the page, belong to Advanced options.
    expect(container.textContent).not.toMatch(/selector|attribute|regex|pattern|sampled|extract|field|pagination|h3 a/i);
  });

  it('shows which columns are ticked, and a column left out says so', () => {
    renderColumns();
    expect(screen.getByRole('checkbox', { name: 'Keep the column Title' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Keep the column Action' })).not.toBeChecked();
    expect(screen.getByText('Left out')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name of the column Action' })).toBeDisabled();
  });

  it('unticks and ticks a column', async () => {
    const handlers = renderColumns();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep the column Price' }));
    expect(handlers.onToggleField).toHaveBeenCalledWith('f_price');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep the column Action' }));
    expect(handlers.onToggleField).toHaveBeenCalledWith('f_action');
  });

  it('renames a column when the user types over its name and leaves the box', async () => {
    const handlers = renderColumns();
    const name = screen.getByRole('textbox', { name: 'Name of the column Title' });
    await userEvent.clear(name);
    await userEvent.type(name, '  Book name ');
    // Nothing is renamed letter by letter.
    expect(handlers.onRenameField).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(handlers.onRenameField).toHaveBeenCalledTimes(1);
    expect(handlers.onRenameField).toHaveBeenCalledWith('f_title', 'Book name');
  });

  it('renames on Enter, and Escape puts the old name back', async () => {
    const handlers = renderColumns();
    const name = screen.getByRole('textbox', { name: 'Name of the column Price' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Cost{Enter}');
    expect(handlers.onRenameField).toHaveBeenCalledWith('f_price', 'Cost');

    await userEvent.clear(name);
    await userEvent.type(name, 'Oops{Escape}');
    expect(name).toHaveValue('Price');
    expect(handlers.onRenameField).toHaveBeenCalledTimes(1);
  });

  it('never leaves a column without a name', async () => {
    const handlers = renderColumns();
    const name = screen.getByRole('textbox', { name: 'Name of the column Title' });
    await userEvent.clear(name);
    fireEvent.blur(name);
    expect(handlers.onRenameField).not.toHaveBeenCalled();
    expect(name).toHaveValue('Title');
  });

  it('never gives two columns the same name, which would put two values in one cell', async () => {
    const handlers = renderColumns();
    const name = screen.getByRole('textbox', { name: 'Name of the column Title' });
    await userEvent.clear(name);
    await userEvent.type(name, 'price');
    fireEvent.blur(name);
    expect(handlers.onRenameField).toHaveBeenCalledWith('f_title', 'price 2');
  });

  it('cannot start with no column ticked, and says why', () => {
    renderColumns({ selectedFieldIds: new Set() });
    expect(screen.getByRole('button', { name: 'Start collecting' })).toBeDisabled();
    expect(screen.getByText('Tick at least one column to start.')).toBeInTheDocument();
  });

  it('starts collecting, and goes back', async () => {
    const handlers = renderColumns();
    await userEvent.click(screen.getByRole('button', { name: 'Start collecting' }));
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('says it is still reading while the page has not answered with columns', () => {
    renderColumns({ fields: [], selectedFieldIds: new Set() });
    expect(screen.getByText('Reading the columns from the page…')).toBeInTheDocument();
    expect(screen.queryByText('Tick at least one column to start.')).not.toBeInTheDocument();
  });
});

describe('Simple mode: the one question about more pages (R1, R5)', () => {
  it('offers to get more pages, already chosen, when the page shows a Next button', () => {
    renderColumns({
      detectedList: { ...LIST, moreItems: 'next' },
      pagination: { ...BASE, type: 'next_button', maxPages: 5 },
    });
    const question = screen.getByRole('group', { name: 'This list continues on more pages. Get them too?' });
    expect(within(question).getByRole('radio', { name: 'Yes, get more pages' })).toBeChecked();
    expect(within(question).getByRole('radio', { name: 'No, just this page' })).not.toBeChecked();
    expect(within(question).getByRole('spinbutton', { name: 'Stop after this many pages:' })).toHaveValue(5);
    // PageHarvest saw the button, so it does not ask how the site shows more.
    expect(within(question).queryByRole('radio', { name: /scroll/i })).not.toBeInTheDocument();
  });

  it('asks, with "just this page" chosen, when it saw no way to more items', () => {
    renderColumns({ detectedList: { ...LIST, moreItems: 'none' } });
    const question = screen.getByRole('group', { name: 'Does this list continue on more pages?' });
    expect(within(question).getByRole('radio', { name: 'No, just this page' })).toBeChecked();
    expect(within(question).getByRole('radio', { name: 'Yes, it has a Next button or page numbers' })).not.toBeChecked();
    expect(within(question).getByRole('radio', { name: 'Yes, more items appear when I scroll down' })).not.toBeChecked();
    // No number to think about until the answer is yes.
    expect(within(question).queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('writes each answer into the pagination settings', async () => {
    const handlers = renderColumns({ detectedList: { ...LIST, moreItems: 'none' } });
    await userEvent.click(screen.getByRole('radio', { name: 'Yes, it has a Next button or page numbers' }));
    expect(handlers.onPaginationChange).toHaveBeenLastCalledWith({ type: 'next_button', maxPages: 5 });
    await userEvent.click(screen.getByRole('radio', { name: 'Yes, more items appear when I scroll down' }));
    expect(handlers.onPaginationChange).toHaveBeenLastCalledWith({ type: 'infinite_scroll', scrollCount: 10 });
  });

  it('turns more pages off', async () => {
    const handlers = renderColumns({
      detectedList: { ...LIST, moreItems: 'next' },
      pagination: { ...BASE, type: 'next_button', maxPages: 5 },
    });
    await userEvent.click(screen.getByRole('radio', { name: 'No, just this page' }));
    expect(handlers.onPaginationChange).toHaveBeenLastCalledWith({ type: 'none' });
  });

  it('lets the user choose how many pages, and never more than 50', () => {
    const handlers = renderColumns({
      detectedList: { ...LIST, moreItems: 'next' },
      pagination: { ...BASE, type: 'next_button', maxPages: 5 },
    });
    const pages = screen.getByRole('spinbutton', { name: 'Stop after this many pages:' });
    fireEvent.change(pages, { target: { value: '12' } });
    expect(handlers.onPaginationChange).toHaveBeenLastCalledWith({ type: 'next_button', maxPages: 12 });
    fireEvent.change(pages, { target: { value: '400' } });
    expect(handlers.onPaginationChange).toHaveBeenLastCalledWith({ type: 'next_button', maxPages: 50 });
    // An emptied box is not a number of pages; the setting is left as it was.
    handlers.onPaginationChange.mockClear();
    fireEvent.change(pages, { target: { value: '' } });
    expect(handlers.onPaginationChange).not.toHaveBeenCalled();
  });

  it('counts scrolls, not pages, for a page that grows as you scroll', () => {
    const handlers = renderColumns({ pagination: { ...BASE, type: 'infinite_scroll', scrollCount: 10 } });
    const scrolls = screen.getByRole('spinbutton', { name: 'Stop after scrolling this many times:' });
    expect(scrolls).toHaveValue(10);
    fireEvent.change(scrolls, { target: { value: '25' } });
    expect(handlers.onPaginationChange).toHaveBeenLastCalledWith({ type: 'infinite_scroll', scrollCount: 25 });
  });
});
