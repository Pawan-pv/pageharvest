import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../../entrypoints/sidepanel/App';
import { db } from '@/storage/db';

const DATASET_ID = 'ds_grid';

async function openSavedDataset() {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Datasets' }));
  fireEvent.click(await screen.findByText('Grid Dataset'));
  await screen.findByText('3 records');
}

describe('Grid edits reach IndexedDB through the production App wiring', () => {
  beforeEach(async () => {
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists a deleted column in the dataset and its records', async () => {
    await openSavedDataset();

    fireEvent.click(screen.getAllByTitle('Delete column')[1]);

    await waitFor(async () => {
      const dataset = await db.datasets.get(DATASET_ID);
      expect(dataset?.fields.map((field) => field.name)).toEqual(['Name']);
      const rows = await db.records.where('datasetId').equals(DATASET_ID).toArray();
      expect(rows.every((row) => !('Price' in row))).toBe(true);
    });
  });

  it('persists a bulk row delete and updates the saved row count', async () => {
    await openSavedDataset();

    fireEvent.click(screen.getByLabelText(/select all rows on page/i));
    fireEvent.click(screen.getAllByLabelText('Select row')[0]);
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));

    await waitFor(async () => {
      expect(await db.records.where('datasetId').equals(DATASET_ID).count()).toBe(1);
      expect((await db.datasets.get(DATASET_ID))?.recordsCount).toBe(1);
    });
  });

  it('keeps earlier cleaning after a later cell edit', async () => {
    await openSavedDataset();

    fireEvent.click(screen.getAllByTitle('Delete column')[1]);
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

    fireEvent.click(screen.getAllByTitle('Delete column')[1]);
    await waitFor(async () => {
      expect((await db.datasets.get(DATASET_ID))?.fields).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    await waitFor(async () => {
      expect((await db.datasets.get(DATASET_ID))?.fields).toHaveLength(2);
      expect((await db.records.get('r2'))?.Price).toBe(2);
    });
  });

  it('reports a failed save and rolls the grid back instead of showing success', async () => {
    await openSavedDataset();
    vi.spyOn(db.datasets, 'update').mockRejectedValue(new Error('disk full'));

    fireEvent.click(screen.getAllByTitle('Delete column')[1]);

    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTitle('Delete column')).toHaveLength(2));
    expect((await db.datasets.get(DATASET_ID))?.fields).toHaveLength(2);
  });
});
