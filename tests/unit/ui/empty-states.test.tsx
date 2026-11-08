import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '@/components/common/EmptyState';
import { DataTable } from '@/components/grid/DataTable';
import { ExtractionHistoryView } from '@/components/history/ExtractionHistoryView';
import { LibraryView } from '@/components/library/LibraryView';
import { RecentProjectsCard } from '@/components/dashboard/RecentProjectsCard';
import { db } from '@/storage/db';
import type { Dataset } from '@/types';

describe('EmptyState', () => {
  it('names the situation and offers the next action', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No rows yet"
        description="Run an extraction to fill this table."
        action={{ label: 'Start an extraction', onClick }}
      />
    );
    expect(screen.getByRole('heading', { name: 'No rows yet' })).toBeInTheDocument();
    expect(screen.getByText('Run an extraction to fill this table.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start an extraction' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows no button when the next step is described but not a click away', () => {
    render(<EmptyState title="Nothing here" description="Choose how to start above." action={null} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Empty screens tell the user what to do', () => {
  it('results table', async () => {
    const onNewExtraction = vi.fn();
    render(<DataTable records={[]} fields={[]} onNewExtraction={onNewExtraction} />);
    expect(screen.getByRole('heading', { name: 'No rows yet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start an extraction' }));
    expect(onNewExtraction).toHaveBeenCalled();
  });

  it('saved datasets, and a search that matches nothing', async () => {
    const onNewExtraction = vi.fn();
    const props = {
      onViewDataset: vi.fn(),
      onDeleteDataset: vi.fn(),
      onGetDatasetRecords: vi.fn().mockResolvedValue([]),
      onNewExtraction,
    };
    const { rerender } = render(<ExtractionHistoryView datasets={[]} {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start an extraction' }));
    expect(onNewExtraction).toHaveBeenCalled();

    const dataset: Dataset = {
      id: 'd1',
      name: 'Books',
      url: 'https://books.test',
      recordsCount: 3,
      fields: [],
      createdAt: 1,
      updatedAt: 1,
    };
    rerender(<ExtractionHistoryView datasets={[dataset]} {...props} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzz' } });
    expect(screen.getByRole('heading', { name: 'No datasets match "zzz"' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('recent extractions on the start screen point at the options above', () => {
    render(<RecentProjectsCard datasets={[]} onViewDataset={vi.fn()} onViewAllHistory={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'No recent extractions' })).toBeInTheDocument();
    expect(screen.getByText(/Choose how to start above/)).toBeInTheDocument();
  });

  describe('library sections', () => {
    beforeEach(async () => {
      await db.clearAllData();
    });

    it.each([
      ['Projects', 'No projects yet'],
      ['Recipes', 'No saved recipes'],
      ['Schemas', 'No schemas yet'],
      ['Run History', 'No runs yet'],
    ])('%s', async (tab, title) => {
      const onNewExtraction = vi.fn();
      render(
        <LibraryView
          datasets={[]}
          onViewDataset={vi.fn()}
          onDeleteDataset={vi.fn()}
          onGetDatasetRecords={vi.fn().mockResolvedValue([])}
          onNewExtraction={onNewExtraction}
          onRunRecipe={vi.fn()}
          onUseSchema={vi.fn()}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: tab }));
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Start an extraction' }));
      expect(onNewExtraction).toHaveBeenCalled();
    });
  });
});
