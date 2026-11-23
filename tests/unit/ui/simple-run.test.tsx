import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JSZip from 'jszip';
import { SavedFileNotice } from '@/components/common/SavedFileNotice';
import { nameWithoutDate } from '@/components/grid/download-rows';
import { SimpleDone } from '@/components/simple/Done';
import { SimpleProgress } from '@/components/simple/Progress';
import type { ExtractionStats } from '@/hooks/useExtractionWorkflow';
import type { Dataset, ExtractedRecord, FieldDefinition } from '@/types';

const STATS: ExtractionStats = {
  progressKind: 'pages',
  currentStep: 2,
  targetSteps: 5,
  totalExtracted: 40,
  duplicatesSkipped: 3,
  recordsDetected: 43,
  recordsWithMissingFields: 4,
  recordsFiltered: 0,
  recordsFailed: 0,
  elapsedSeconds: 12,
  status: 'RUNNING',
};

const FIELDS: FieldDefinition[] = [
  { id: 'f_title', name: 'Title', selector: 'h3', extractor: 'text' },
  { id: 'f_price', name: 'Price', selector: '.price', extractor: 'number' },
];

const row = (index: number): ExtractedRecord => ({
  _id: `r${index}`,
  _page: 1,
  _extractedAt: 1,
  Title: `Book ${index}`,
  Price: 10 + index,
});
const ROWS = [1, 2, 3, 4, 5, 6, 7].map(row);

const DATASET: Dataset = {
  id: 'ds_books',
  name: 'All products | Books to Scrape - 11/12/2026',
  url: 'https://books.toscrape.com/catalogue/page-1.html',
  recordsCount: 7,
  fields: FIELDS,
  createdAt: new Date(2026, 10, 12).getTime(),
  updatedAt: new Date(2026, 10, 12).getTime(),
};

/** What each download handed to Chrome, read back so a test can open the file. */
const blobs: Blob[] = [];

/** jsdom's Blob has no arrayBuffer() or text(), so the bytes are read with a FileReader. */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const textOf = async (blob: Blob) => new TextDecoder().decode(await bytesOf(blob));

beforeEach(() => {
  blobs.length = 0;
  // jsdom has no object URLs; the download path needs one for a binary file.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:pageharvest-test/${blobs.length}`;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderProgress(stats: Partial<ExtractionStats> = {}) {
  const handlers = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onClose: vi.fn() };
  const view = render(<SimpleProgress stats={{ ...STATS, ...stats }} {...handlers} />);
  return { ...handlers, ...view };
}

function renderDone(props: Partial<React.ComponentProps<typeof SimpleDone>> = {}) {
  const handlers = { onOpenTable: vi.fn(), onNewExtraction: vi.fn() };
  const view = render(
    <SimpleDone dataset={DATASET} records={ROWS} fields={FIELDS} justFinished runSummary={null} {...handlers} {...props} />
  );
  return { ...handlers, ...view };
}

describe('Simple mode: collecting (T1, step 4)', () => {
  it('shows the rows saved and how far along it is, and none of the counts only an expert reads', () => {
    const { container } = renderProgress();
    expect(screen.getByRole('heading', { name: 'Collecting your rows…' })).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('rows saved so far')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'How far along' })).toHaveAttribute('aria-valuenow', '40');
    expect(container.textContent).not.toMatch(/duplicate|excluded|detected|failed|missing|job|extraction|scope/i);
  });

  it('says "1 row" for one', () => {
    renderProgress({ totalExtracted: 1 });
    expect(screen.getByText('row saved so far')).toBeInTheDocument();
  });

  it('shows no page count for a single page', () => {
    renderProgress({ progressKind: 'single', currentStep: 1, targetSteps: 1 });
    expect(screen.queryByText(/Page \d/)).not.toBeInTheDocument();
    expect(screen.queryByText('This page')).not.toBeInTheDocument();
  });

  it('tells the user the panel can be closed', () => {
    renderProgress();
    expect(screen.getByText(/You can close this panel\. PageHarvest keeps working/)).toBeInTheDocument();
  });

  it('has one way to stop, and it keeps the rows', async () => {
    const handlers = renderProgress();
    await userEvent.click(screen.getByRole('button', { name: 'Stop here and keep my rows' }));
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    // A second "cancel" that also keeps the rows would be a choice with no difference.
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('pauses, and continues from a pause', async () => {
    const handlers = renderProgress();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(handlers.onPause).toHaveBeenCalledTimes(1);

    handlers.unmount();
    const paused = renderProgress({ status: 'PAUSED' });
    expect(screen.getByRole('heading', { name: 'Paused' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(paused.onResume).toHaveBeenCalledTimes(1);
  });

  it('explains a problem, keeps the rows reachable, and can be closed', async () => {
    const handlers = renderProgress({
      status: 'FAILED',
      errorCode: 'PAGINATION_TIMEOUT',
      errorMessage: 'The page did not load within 30000 ms.',
    });
    expect(screen.getByRole('heading', { name: 'A problem stopped the collecting' })).toBeInTheDocument();
    expect(screen.getByText('The next page did not open')).toBeInTheDocument();
    expect(screen.getByText(/Rows from earlier pages are saved/)).toBeInTheDocument();
    expect(screen.queryByText(/You can close this panel/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'See the rows I have' }));
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Simple mode: the Done screen (T1, step 5; R4)', () => {
  it('says how many rows were collected, from where, and that they are saved', () => {
    const { container } = renderDone();
    expect(screen.getByRole('heading', { name: 'Done. 7 rows collected' })).toBeInTheDocument();
    expect(screen.getByText('From books.toscrape.com. They are saved in My data.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/record|dataset|extraction|IndexedDB|filtered|duplicate|export/i);
  });

  it('shows the first rows as a plain table, and says the file has the rest', () => {
    renderDone();
    const table = screen.getByRole('table', { name: 'The first rows' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Title', 'Price']);
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getByText('Book 5')).toBeInTheDocument();
    expect(within(table).queryByText('Book 6')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 7 rows. The file has all of them.')).toBeInTheDocument();
  });

  it('saves a real Excel file with every row in one click, with no "Save as" window', async () => {
    renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'Download for Excel' }));

    await waitFor(() => expect(chromeMock.downloads.download).toHaveBeenCalledTimes(1));
    const request = chromeMock.downloads.download.mock.calls[0][0];
    expect(request.saveAs).toBe(false);
    expect(request.conflictAction).toBe('uniquify');
    // Named after the list and today, without repeating the date the list's name already ends with.
    expect(request.filename).toMatch(/^all-products-books-to-scrape-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // The bytes handed to Chrome are a workbook an independent reader can open.
    const zip = await JSZip.loadAsync(await bytesOf(blobs[0]));
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet.match(/<row /g)).toHaveLength(ROWS.length + 1);
    expect(sheet).toContain('Book 7');
    // A number stays a number, so Excel can add the column up.
    expect(sheet).toContain('<v>17</v>');
  });

  it('says "saved" only once Chrome has written the file, with the name it really has', async () => {
    // Chrome is still writing when the click returns.
    chromeMock.downloadItems.set(12345, { id: 12345, state: 'in_progress', filename: '' });
    renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'Download for Excel' }));

    expect(await screen.findByText('Saving the file…')).toBeInTheDocument();
    expect(screen.queryByText('File saved')).not.toBeInTheDocument();

    // "books.xlsx" was taken, so Chrome added a number.
    chromeMock.downloadItems.set(12345, {
      id: 12345,
      state: 'complete',
      filename: 'C:\\Users\\someone\\Downloads\\books (1).xlsx',
    });
    expect(await screen.findByText('File saved')).toBeInTheDocument();
    expect(screen.getByText('books (1).xlsx')).toBeInTheDocument();
    // The folder path on the user's disk is never shown.
    expect(document.body.textContent).not.toContain('C:\\Users');
  });

  it('opens the folder with the file selected', async () => {
    renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'Download for Excel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show in folder' }));
    expect(chromeMock.downloads.show).toHaveBeenCalledWith(12345);
  });

  it('says the file was not saved, and why, when Chrome stops the download', async () => {
    chromeMock.downloadItems.set(12345, { id: 12345, state: 'interrupted', error: 'FILE_NO_SPACE', filename: '' });
    renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'Download for Excel' }));

    expect(await screen.findByText('The file was not saved')).toBeInTheDocument();
    expect(screen.getByText('The disk is full.')).toBeInTheDocument();
    expect(screen.getByText(/Your rows are still saved in PageHarvest/)).toBeInTheDocument();
    expect(screen.queryByText('File saved')).not.toBeInTheDocument();
  });

  it('says the download did not work when Chrome refuses it', async () => {
    chromeMock.downloads.download.mockRejectedValueOnce(new Error('Download canceled by the browser'));
    renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'Download for Excel' }));

    expect(await screen.findByText('That did not work')).toBeInTheDocument();
    expect(screen.queryByText('File saved')).not.toBeInTheDocument();
    expect(screen.queryByText('Saving the file…')).not.toBeInTheDocument();
  });

  it('offers a CSV file as the other way', async () => {
    renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'Download a CSV file' }));
    await waitFor(() => expect(chromeMock.downloads.download).toHaveBeenCalledTimes(1));
    expect(chromeMock.downloads.download.mock.calls[0][0].filename).toMatch(/\.csv$/);
    const text = await textOf(blobs[0]);
    expect(text).toContain('Title,Price');
    expect(text).toContain('Book 7,17');
  });

  it('copies the table so it pastes into spreadsheet cells, one value per cell', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'Copy the table' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied.split(/\r?\n/)[0]).toBe('Title\tPrice');
    expect(copied).toContain('Book 1\t11');
    expect(await screen.findByRole('button', { name: 'Copied. Paste it into a spreadsheet' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('cancels the copied-message timer when the screen closes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderDone();

    await userEvent.click(screen.getByRole('button', { name: 'Copy the table' }));
    const timer = await waitFor(() => {
      const index = setTimer.mock.calls.findIndex((call) => call[1] === 2500);
      expect(index).toBeGreaterThanOrEqual(0);
      return setTimer.mock.results[index]?.value as ReturnType<typeof setTimeout>;
    });

    unmount();

    expect(clearTimer).toHaveBeenCalledWith(timer);
    vi.unstubAllGlobals();
  });

  it('opens the full table, and starts another list', async () => {
    const handlers = renderDone();
    await userEvent.click(screen.getByRole('button', { name: 'See and change all rows' }));
    expect(handlers.onOpenTable).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Get another list' }));
    expect(handlers.onNewExtraction).toHaveBeenCalledTimes(1);
  });

  it('says when it stopped at the page limit the user chose', () => {
    renderDone({ runSummary: { stopReason: 'max_pages_reached', currentStep: 5, progressKind: 'pages' } });
    expect(screen.getByText('It stopped after 5 pages, the limit you chose. The list may have more.')).toBeInTheDocument();
  });

  it('says nothing about limits when the list simply ended', () => {
    renderDone({ runSummary: { stopReason: 'control_disabled_or_missing', currentStep: 3, progressKind: 'pages' } });
    expect(screen.queryByText(/limit you chose/)).not.toBeInTheDocument();
  });

  it('does not call an empty result done: it says what happened and what to try', async () => {
    const handlers = renderDone({ records: [] });
    expect(screen.getByText('No rows were collected')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Done/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download for Excel' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(handlers.onNewExtraction).toHaveBeenCalledTimes(1);
  });

  it('shows saved data opened later under its own name, not as "Done"', () => {
    renderDone({ justFinished: false });
    expect(screen.getByRole('heading', { name: DATASET.name })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Done/ })).not.toBeInTheDocument();
    expect(screen.getByText(/^7 rows from books\.toscrape\.com, collected on /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download for Excel' })).toBeInTheDocument();
  });

  it('uses the columns of the rows when no column list was saved with them', () => {
    renderDone({ fields: [] });
    const table = screen.getByRole('table', { name: 'The first rows' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Title', 'Price']);
  });
});

describe('The name of a downloaded file', () => {
  it('leaves out the date a saved list is named with, whichever way round it is written', () => {
    expect(nameWithoutDate('Books to Scrape - 11/12/2026')).toBe('Books to Scrape');
    expect(nameWithoutDate('Books to Scrape - 12.11.2026')).toBe('Books to Scrape');
    expect(nameWithoutDate('Books to Scrape - 2026-11-12')).toBe('Books to Scrape');
  });

  it('leaves a name without a date, and numbers inside a name, alone', () => {
    expect(nameWithoutDate('Top 10 laptops')).toBe('Top 10 laptops');
    expect(nameWithoutDate('Sale 11/12 only')).toBe('Sale 11/12 only');
    expect(nameWithoutDate(undefined)).toBeUndefined();
  });
});

describe('What became of a download', () => {
  it('does not show the answer for an earlier download as the answer for a new one', async () => {
    chromeMock.downloadItems.set(1, { id: 1, state: 'complete', filename: '/d/first.xlsx' });
    chromeMock.downloadItems.set(2, { id: 2, state: 'in_progress', filename: '' });
    const view = render(<SavedFileNotice downloadId={1} />);
    expect(await screen.findByText('first.xlsx')).toBeInTheDocument();

    view.rerender(<SavedFileNotice downloadId={2} />);
    expect(screen.getByText('Saving the file…')).toBeInTheDocument();
    expect(screen.queryByText('first.xlsx')).not.toBeInTheDocument();
  });

  it('says where to look when the folder cannot be opened', async () => {
    chromeMock.downloadItems.set(3, { id: 3, state: 'complete', filename: '/d/rows.xlsx' });
    chromeMock.downloads.show.mockImplementationOnce(() => {
      throw new Error('The file was moved');
    });
    render(<SavedFileNotice downloadId={3} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show in folder' }));
    expect(screen.getByText('The folder could not be opened. Look in your Downloads folder.')).toBeInTheDocument();
  });

  it('can be dismissed', async () => {
    chromeMock.downloadItems.set(4, { id: 4, state: 'complete', filename: '/d/rows.xlsx' });
    const onDismiss = vi.fn();
    render(<SavedFileNotice downloadId={4} onDismiss={onDismiss} />);
    await screen.findByText('File saved');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
