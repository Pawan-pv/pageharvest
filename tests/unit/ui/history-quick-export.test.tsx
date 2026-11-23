import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtractionHistoryView } from '@/components/history/ExtractionHistoryView';
import { db } from '@/storage/db';
import type { Dataset, ExtractedRecord } from '@/types';

const DATASET: Dataset = {
  id: 'ds_books',
  name: 'Books Category',
  url: 'https://books.example.com',
  recordsCount: 2,
  fields: [
    { id: 'f1', name: 'Title', selector: 'h3', extractor: 'text' },
    { id: 'f2', name: 'Price', selector: '.price', extractor: 'number' },
  ],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const ROWS: ExtractedRecord[] = [
  { _id: 'r1', _page: 1, _extractedAt: 1, Title: 'One', Price: 1.5 },
  { _id: 'r2', _page: 1, _extractedAt: 1, Title: 'Two, the sequel', Price: 2 },
];

/** What each download handed to Chrome. */
const blobs: Blob[] = [];

function textOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * The CSV and JSON buttons on each saved list (Advanced options). They use the real
 * exporter and the real download path; only Chrome is the mock.
 */
describe('Saved data: the quick CSV and JSON downloads', () => {
  beforeEach(async () => {
    blobs.length = 0;
    await db.settings.clear();
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:pageharvest-test/${blobs.length}`;
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderList() {
    const onViewDataset = vi.fn();
    render(
      <ExtractionHistoryView
        datasets={[DATASET]}
        onViewDataset={onViewDataset}
        onDeleteDataset={vi.fn()}
        onGetDatasetRecords={vi.fn().mockResolvedValue(ROWS)}
        onNewExtraction={vi.fn()}
      />
    );
    return { onViewDataset };
  }

  it('saves the rows as CSV without opening the list, and says where the file is', async () => {
    const { onViewDataset } = renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Export Books Category as CSV' }));

    await waitFor(() => expect(chromeMock.downloads.download).toHaveBeenCalledTimes(1));
    expect(chromeMock.downloads.download.mock.calls[0][0]).toMatchObject({ filename: 'books_category.csv', saveAs: false });
    const csv = await textOf(blobs[0]);
    expect(csv).toContain('Title,Price');
    // A comma inside a value is quoted, so it stays one cell.
    expect(csv).toContain('"Two, the sequel",2');
    // Without a "Save as" window, the panel is what tells the user where the file went.
    expect(await screen.findByText('File saved')).toBeInTheDocument();
    expect(screen.getByText('books_category.csv')).toBeInTheDocument();
    expect(onViewDataset).not.toHaveBeenCalled();
  });

  it('saves the rows as JSON', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Export Books Category as JSON' }));

    await waitFor(() => expect(chromeMock.downloads.download).toHaveBeenCalledTimes(1));
    expect(chromeMock.downloads.download.mock.calls[0][0].filename).toBe('books_category.json');
    expect(JSON.parse(await textOf(blobs[0]))).toEqual([
      { Title: 'One', Price: 1.5 },
      { Title: 'Two, the sequel', Price: 2 },
    ]);
    expect(await screen.findByText('File saved')).toBeInTheDocument();
  });

  it('says the export failed, and shows no "saved", when Chrome refuses the download', async () => {
    chromeMock.downloads.download.mockRejectedValueOnce(new Error('Download canceled by the browser'));
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Export Books Category as CSV' }));

    expect(await screen.findByText(/Export failed: Download canceled by the browser/)).toBeInTheDocument();
    expect(screen.queryByText('File saved')).not.toBeInTheDocument();
  });
});
