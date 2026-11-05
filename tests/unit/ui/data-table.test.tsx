import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DataTable } from '@/components/grid/DataTable';
import { ExtractedRecord, FieldDefinition, Dataset } from '@/types';

// Mock exporter functions
vi.mock('@/core/export/exporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/export/exporter')>();
  return {
    ...actual,
    recordsToCsv: vi.fn(() => 'Title,Price\r\nItem A,10.00'),
    recordsToJson: vi.fn(() => '[{"Title":"Item A","Price":10.00}]'),
  };
});

vi.mock('@/platform/downloads', () => ({
  triggerDownload: vi.fn().mockResolvedValue({ success: true }),
}));

describe('UI: Data Table & Spreadsheet Management', () => {
  const sampleFields: FieldDefinition[] = [
    { id: 'f_title', name: 'Title', selector: 'h2', extractor: 'text' },
    { id: 'f_price', name: 'Price', selector: '.price', extractor: 'number' },
  ];

  const sampleRecords: ExtractedRecord[] = [
    { _id: 'rec_1', _page: 1, _extractedAt: 1700000000, Title: 'Wireless Mouse', Price: '25.99' },
    { _id: 'rec_2', _page: 1, _extractedAt: 1700000001, Title: 'Mechanical Keyboard', Price: '89.99' },
    { _id: 'rec_3', _page: 2, _extractedAt: 1700000002, Title: 'USB-C Cable', Price: '9.99' },
  ];

  const sampleDataset: Dataset = {
    id: 'ds_101',
    name: 'Tech Accessories',
    url: 'https://shop.example.com',
    recordsCount: 3,
    fields: sampleFields,
    createdAt: 1700000000,
    updatedAt: 1700000000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders table headers and rows with summary metrics', () => {
    render(
      <DataTable
        dataset={sampleDataset}
        records={sampleRecords}
        fields={sampleFields}
      />
    );

    expect(screen.getByText('Tech Accessories')).toBeInTheDocument();
    expect(screen.getByText(/3 records/i)).toBeInTheDocument();
    expect(screen.getByText('2 columns')).toBeInTheDocument();

    expect(screen.getByText('Wireless Mouse')).toBeInTheDocument();
    expect(screen.getByText('Mechanical Keyboard')).toBeInTheDocument();
    expect(screen.getByText('USB-C Cable')).toBeInTheDocument();
  });

  it('filters rows when user types in global search input', async () => {
    render(
      <DataTable
        dataset={sampleDataset}
        records={sampleRecords}
        fields={sampleFields}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search across all columns...');
    fireEvent.change(searchInput, { target: { value: 'Keyboard' } });

    expect(screen.getByText('Mechanical Keyboard')).toBeInTheDocument();
    expect(screen.queryByText('Wireless Mouse')).not.toBeInTheDocument();
    expect(screen.queryByText('USB-C Cable')).not.toBeInTheDocument();
  });

  it('sorts columns when clicking column headers', () => {
    render(
      <DataTable
        dataset={sampleDataset}
        records={sampleRecords}
        fields={sampleFields}
      />
    );

    const titleHeader = screen.getByText('Title');
    fireEvent.click(titleHeader);

    // Verify rows rendered
    expect(screen.getByText('Mechanical Keyboard')).toBeInTheDocument();
  });

  it('supports inline cell editing on double click', async () => {
    const onUpdateCell = vi.fn();
    render(
      <DataTable
        dataset={sampleDataset}
        records={sampleRecords}
        fields={sampleFields}
        onUpdateCell={onUpdateCell}
      />
    );

    const mouseCell = screen.getByText('Wireless Mouse');
    fireEvent.doubleClick(mouseCell);

    // Input appears for inline editing
    const editInput = screen.getByDisplayValue('Wireless Mouse');
    expect(editInput).toBeInTheDocument();

    fireEvent.change(editInput, { target: { value: 'Ergonomic Wireless Mouse' } });
    fireEvent.blur(editInput);

    expect(onUpdateCell).toHaveBeenCalledWith('rec_1', 'Title', 'Ergonomic Wireless Mouse');
  });

  it('deletes a record when trash button is clicked', () => {
    const onDeleteRecord = vi.fn();
    render(
      <DataTable
        dataset={sampleDataset}
        records={sampleRecords}
        fields={sampleFields}
        onDeleteRecord={onDeleteRecord}
      />
    );

    const deleteButtons = screen.getAllByLabelText('Delete row');
    fireEvent.click(deleteButtons[0]);

    expect(onDeleteRecord).toHaveBeenCalledWith('rec_1');
  });

  it('copies records to clipboard as CSV and shows feedback', async () => {
    render(
      <DataTable
        dataset={sampleDataset}
        records={sampleRecords}
        fields={sampleFields}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('triggers CSV and JSON export downloads', async () => {
    const { triggerDownload } = await import('@/platform/downloads');

    render(
      <DataTable
        dataset={sampleDataset}
        records={sampleRecords}
        fields={sampleFields}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: /^CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Download File' }));
    await waitFor(() => expect(triggerDownload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: expect.arrayContaining([expect.any(String)]),
        filename: expect.stringMatching(/^tech-accessories-\d{4}-\d{2}-\d{2}\.csv$/),
        mimeType: 'text/csv',
      })
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('button', { name: /^JSON/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Download File' }));
    await waitFor(() => expect(triggerDownload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: expect.arrayContaining([expect.any(String)]),
        filename: expect.stringMatching(/^tech-accessories-\d{4}-\d{2}-\d{2}\.json$/),
        mimeType: 'application/json',
      })
    ));
  });

  it('renders EmptyState when records list is empty', () => {
    render(
      <DataTable
        dataset={sampleDataset}
        records={[]}
        fields={sampleFields}
      />
    );

    expect(screen.getByText(/No records extracted/i)).toBeInTheDocument();
  });
});
