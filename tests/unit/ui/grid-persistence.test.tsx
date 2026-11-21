import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../../entrypoints/sidepanel/App';
import { db } from '@/storage/db';
import { installBackground } from '../../utils/job-harness';

const DATASET_ID = 'ds_grid';

/**
 * Deleting asks first, in a dialog inside the panel (a browser confirm() box is not
 * reliably shown for a side panel). This presses Delete in it and waits for what the grid
 * says next. The wait starts in the same tick as the click, so the grid's own follow-up
 * renders are inside it.
 */
async function confirmDelete(thenShows: RegExp | string) {
  const button = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' });
  fireEvent.click(button);
  await screen.findByText(thenShows);
}

/** Deletes a column. The grid says "Deleted column" only once the change is stored. */
async function deleteColumn(index: number, thenShows: RegExp | string = /^Deleted column /) {
  fireEvent.click(screen.getAllByTitle('Delete column')[index]);
  await confirmDelete(thenShows);
}

async function openSavedDataset() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'My data' }));
  fireEvent.click(await screen.findByText('Grid Dataset'));
  await screen.findByText('3 records');
}

describe('Grid edits reach IndexedDB through the production App wiring', () => {
  beforeEach(async () => {
    installBackground(db);
    await Promise.all([db.datasets.clear(), db.records.clear()]);
    await db.datasets.put({
      id: DATASET_ID,
      name: 'Grid Dataset',
      url: 'https://example.com/grid',
      recordsCount: 3,
      fields: [
        { id: 'a', name: 'Name', selector: '.a', extractor: 'text' },
        { id: 'b', name: 'Price', selector: '.b', extractor: 'number' },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    await db.records.bulkPut([
      { _id: 'r1', _page: 1, _extractedAt: 1, _order: 1, datasetId: DATASET_ID, Name: 'One', Price: 1 },
      { _id: 'r2', _page: 1, _extractedAt: 1, _order: 2, datasetId: DATASET_ID, Name: 'Two', Price: 2 },
      { _id: 'r3', _page: 1, _extractedAt: 1, _order: 3, datasetId: DATASET_ID, Name: 'Three', Price: 3 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists a deleted column in the dataset and its records', async () => {
    await openSavedDataset();

    await deleteColumn(1);

    await waitFor(async () => {
      const dataset = await db.datasets.get(DATASET_ID);
      expect(dataset?.fields.map((field) => field.name)).toEqual(['Name']);
      const rows = await db.records.where('datasetId').equals(DATASET_ID).toArray();
      expect(rows.every((row) => !('Price' in row))).toBe(true);
    });
  });

  it('cancels the pending "saved" message timer when the grid closes', async () => {
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    await openSavedDataset();

    await deleteColumn(1);

    // The message is announced only after the save, and clears itself 3 s later.
    const messageTimer = await waitFor(() => {
      const index = setTimer.mock.calls.findIndex((call) => call[1] === 3000);
      expect(index).toBeGreaterThanOrEqual(0);
      return setTimer.mock.results[index]?.value as ReturnType<typeof setTimeout>;
    });
    cleanup();

    expect(clearTimer).toHaveBeenCalledWith(messageTimer);
  });

  it('asks before deleting a column, never with a browser confirm box, and keeps it when the answer is no', async () => {
    const browserConfirm = vi.spyOn(window, 'confirm');
    await openSavedDataset();

    fireEvent.click(screen.getAllByTitle('Delete column')[1]);
    const dialog = await screen.findByRole('dialog', { name: 'Delete the column "Price"?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(browserConfirm).not.toHaveBeenCalled();
    expect(screen.getAllByTitle('Delete column')).toHaveLength(2);
    expect((await db.datasets.get(DATASET_ID))?.fields).toHaveLength(2);
  });

  it('persists a bulk row delete and updates the saved row count', async () => {
    await openSavedDataset();

    fireEvent.click(screen.getByLabelText(/select all rows on page/i));
    fireEvent.click(screen.getAllByLabelText('Select row')[0]);
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await confirmDelete('Deleted 2 row(s)');

    await waitFor(async () => {
      expect(await db.records.where('datasetId').equals(DATASET_ID).count()).toBe(1);
      expect((await db.datasets.get(DATASET_ID))?.recordsCount).toBe(1);
    });
  });

  it('keeps earlier cleaning after a later cell edit', async () => {
    await openSavedDataset();

    await deleteColumn(1);
    await waitFor(() => expect(screen.getAllByTitle('Delete column')).toHaveLength(1));

    const row = screen.getByText('One').closest('tr') as HTMLElement;
    fireEvent.doubleClick(within(row).getByText('One'));
    const input = await screen.findByDisplayValue('One');
    fireEvent.change(input, { target: { value: 'Uno' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(async () => {
      expect((await db.records.get('r1'))?.Name).toBe('Uno');
    });
    expect(screen.getAllByTitle('Delete column')).toHaveLength(1);
    expect(screen.queryByRole('columnheader', { name: /Price/ })).not.toBeInTheDocument();
  });

  it('keeps undo history across a cell edit and persists the undo', async () => {
    await openSavedDataset();

    await deleteColumn(1);
    await waitFor(async () => {
      expect((await db.datasets.get(DATASET_ID))?.fields).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    await waitFor(async () => {
      expect((await db.datasets.get(DATASET_ID))?.fields).toHaveLength(2);
      expect((await db.records.get('r2'))?.Price).toBe(2);
    });
    expect(await screen.findByText('Undone. Your last change was taken back.')).toBeInTheDocument();
  });

  it('reports a failed save and rolls the grid back instead of showing success', async () => {
    await openSavedDataset();
    vi.spyOn(db.datasets, 'update').mockRejectedValue(new Error('disk full'));

    await deleteColumn(1, /disk full/);

    expect(screen.getByText(/disk full/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTitle('Delete column')).toHaveLength(2));
    expect((await db.datasets.get(DATASET_ID))?.fields).toHaveLength(2);
  });
});
