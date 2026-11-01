import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExtractionHistoryView } from '@/components/history/ExtractionHistoryView';
import { SettingsView } from '@/components/settings/SettingsView';
import { Dataset } from '@/types';
import { db } from '@/storage/db';

vi.mock('@/core/export/exporter', () => ({
  recordsToCsv: vi.fn(() => 'col1,col2'),
  recordsToJson: vi.fn(() => '[]'),
}));

vi.mock('@/platform/downloads', () => ({
  triggerDownload: vi.fn().mockResolvedValue({ success: true }),
}));

describe('UI: History & Settings Management', () => {
  const mockDatasets: Dataset[] = [
    {
      id: 'ds_alpha',
      name: 'Books Category',
      url: 'https://books.example.com',
      recordsCount: 30,
      fields: [{ id: 'f1', name: 'Title', selector: 'h3', extractor: 'text' }],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
    {
      id: 'ds_beta',
      name: 'Electronics Catalog',
      url: 'https://electronics.example.com',
      recordsCount: 15,
      fields: [{ id: 'f2', name: 'Model', selector: '.model', extractor: 'text' }],
      createdAt: 1700000100000,
      updatedAt: 1700000100000,
    },
  ];

  describe('ExtractionHistoryView', () => {
    it('renders list of datasets with row counts and URLs', () => {
      render(
        <ExtractionHistoryView
          datasets={mockDatasets}
          onViewDataset={vi.fn()}
          onDeleteDataset={vi.fn()}
          onGetDatasetRecords={vi.fn().mockResolvedValue([])}
          onNewExtraction={vi.fn()}
        />
      );

      expect(screen.getByText('Books Category')).toBeInTheDocument();
      expect(screen.getByText('Electronics Catalog')).toBeInTheDocument();
      expect(screen.getByText('30 rows')).toBeInTheDocument();
      expect(screen.getByText('15 rows')).toBeInTheDocument();
    });

    it('filters datasets by search query', () => {
      render(
        <ExtractionHistoryView
          datasets={mockDatasets}
          onViewDataset={vi.fn()}
          onDeleteDataset={vi.fn()}
          onGetDatasetRecords={vi.fn().mockResolvedValue([])}
          onNewExtraction={vi.fn()}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search saved datasets...');
      fireEvent.change(searchInput, { target: { value: 'Electronics' } });

      expect(screen.getByText('Electronics Catalog')).toBeInTheDocument();
      expect(screen.queryByText('Books Category')).not.toBeInTheDocument();
    });

    it('opens confirmation modal before deleting dataset', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(
        <ExtractionHistoryView
          datasets={mockDatasets}
          onViewDataset={vi.fn()}
          onDeleteDataset={onDelete}
          onGetDatasetRecords={vi.fn().mockResolvedValue([])}
          onNewExtraction={vi.fn()}
        />
      );

      const deleteBtn = screen.getByLabelText('Delete dataset Books Category');
      fireEvent.click(deleteBtn);

      expect(screen.getByText('Delete Dataset?')).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: 'Delete' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith('ds_alpha');
      });
    });

    it('renders EmptyState when history is empty', () => {
      render(
        <ExtractionHistoryView
          datasets={[]}
          onViewDataset={vi.fn()}
          onDeleteDataset={vi.fn()}
          onGetDatasetRecords={vi.fn().mockResolvedValue([])}
          onNewExtraction={vi.fn()}
        />
      );

      expect(screen.getByText('No saved datasets yet')).toBeInTheDocument();
    });
  });

  describe('SettingsView', () => {
    beforeEach(async () => {
      await db.datasets.clear();
      await db.records.clear();
    });

    it('renders default throttling preferences and saves with feedback', async () => {
      await db.settings.clear();
      render(<SettingsView onBackToDashboard={vi.fn()} />);

      const delayInput = screen.getByLabelText('Default Page Delay (ms)');
      expect(delayInput).toHaveValue(1500);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save Preferences' })).toBeEnabled());

      fireEvent.change(delayInput, { target: { value: '2000' } });
      expect(delayInput).toHaveValue(2000);

      const saveBtn = screen.getByRole('button', { name: 'Save Preferences' });
      fireEvent.click(saveBtn);

      expect(await screen.findByText('Settings saved successfully.')).toBeInTheDocument();
    });

    it('opens confirmation modal when clicking Clear All Saved Data', async () => {
      await db.datasets.add({
        id: 'ds_cleanup',
        name: 'Cleanup Dataset',
        url: 'https://cleanup.example.com',
        recordsCount: 10,
        fields: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      render(<SettingsView onBackToDashboard={vi.fn()} />);

      const clearBtn = await screen.findByRole('button', { name: /clear all saved data/i });
      await waitFor(() => {
        expect(clearBtn).not.toBeDisabled();
      });
      fireEvent.click(clearBtn);

      expect(await screen.findByText('Clear All Saved Data?')).toBeInTheDocument();
    });
  });
});
