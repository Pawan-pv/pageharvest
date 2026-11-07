import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from '@/components/grid/DataTable';
import { ExtractedRecord, FieldDefinition } from '@/types';

describe('DataTable Spreadsheet Workspace Component', () => {
  const sampleFields: FieldDefinition[] = [
    { id: 'f1', name: 'Product', selector: 'h2', extractor: 'text' },
    { id: 'f2', name: 'Price', selector: '.price', extractor: 'number' },
    { id: 'f3', name: 'Category', selector: '.cat', extractor: 'text' },
  ];

  const sampleRecords: ExtractedRecord[] = [
    { _id: 'rec_1', _page: 1, _extractedAt: 1000, Product: 'Mechanical Keyboard', Price: 120, Category: 'Tech' },
    { _id: 'rec_2', _page: 1, _extractedAt: 2000, Product: 'Ergonomic Mouse', Price: 45, Category: 'Tech' },
    { _id: 'rec_3', _page: 2, _extractedAt: 3000, Product: 'Desk Lamp', Price: 30, Category: 'Office' },
  ];

  it('renders table headers and rows correctly', () => {
    render(<DataTable records={sampleRecords} fields={sampleFields} />);

    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Mechanical Keyboard')).toBeInTheDocument();
    expect(screen.getByText('Ergonomic Mouse')).toBeInTheDocument();
    expect(screen.getByText('Desk Lamp')).toBeInTheDocument();
  });

  it('renders empty state when there are 0 records', () => {
    render(<DataTable records={[]} fields={sampleFields} />);

    expect(screen.getByText('No rows yet')).toBeInTheDocument();
    expect(screen.getByText(/Run an extraction to fill this table/i)).toBeInTheDocument();
  });

  it('renders loading state when isLoading is true', () => {
    render(<DataTable records={sampleRecords} fields={sampleFields} isLoading={true} />);

    expect(screen.getByText('Loading data workspace...')).toBeInTheDocument();
    expect(screen.getByText(/Retrieving records from IndexedDB/i)).toBeInTheDocument();
  });

  it('renders error state and handles onRetry callback', () => {
    const handleRetry = vi.fn();
    render(
      <DataTable
        records={sampleRecords}
        fields={sampleFields}
        error="Failed to load IndexedDB records"
        onRetry={handleRetry}
      />
    );

    expect(screen.getByText('Failed to load IndexedDB records')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('filters rows based on search input', async () => {
    const user = userEvent.setup();
    render(<DataTable records={sampleRecords} fields={sampleFields} />);

    const searchInput = screen.getByPlaceholderText(/search across all columns/i);
    await user.type(searchInput, 'Mouse');

    expect(screen.getByText('Ergonomic Mouse')).toBeInTheDocument();
    expect(screen.queryByText('Mechanical Keyboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Desk Lamp')).not.toBeInTheDocument();
  });

  it('sorts columns when clicking header', async () => {
    const user = userEvent.setup();
    render(<DataTable records={sampleRecords} fields={sampleFields} />);

    // Click Price header to sort ascending
    const priceHeader = screen.getByText('Price');
    await user.click(priceHeader);

    const rows = screen.getAllByRole('row');
    // First data row (index 1) should be Desk Lamp ($30)
    expect(rows[1]).toHaveTextContent('Desk Lamp');

    // Click Price header again to sort descending
    await user.click(priceHeader);
    const rowsDesc = screen.getAllByRole('row');
    // First data row should now be Mechanical Keyboard ($120)
    expect(rowsDesc[1]).toHaveTextContent('Mechanical Keyboard');
  });

  it('supports row selection and batch deletion', async () => {
    const user = userEvent.setup();
    const onBatchDelete = vi.fn();

    // Mock confirm dialog
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <DataTable
        records={sampleRecords}
        fields={sampleFields}
        onDeleteRecordsBatch={onBatchDelete}
      />
    );

    // Select all rows on page
    const selectAllCheckbox = screen.getByLabelText(/select all rows on page/i);
    await user.click(selectAllCheckbox);

    expect(screen.getByText('3 row(s) selected')).toBeInTheDocument();

    const deleteSelectedBtn = screen.getByRole('button', { name: /delete selected/i });
    await user.click(deleteSelectedBtn);

    expect(onBatchDelete).toHaveBeenCalledWith(['rec_1', 'rec_2', 'rec_3']);
  });

  it('allows inline editing on cell double click', async () => {
    const user = userEvent.setup();
    const onUpdateCell = vi.fn();

    render(
      <DataTable
        records={sampleRecords}
        fields={sampleFields}
        onUpdateCell={onUpdateCell}
      />
    );

    const cell = screen.getByText('Mechanical Keyboard');
    await user.dblClick(cell);

    const input = screen.getByDisplayValue('Mechanical Keyboard');
    await user.clear(input);
    await user.type(input, 'Gaming Keyboard{enter}');

    expect(onUpdateCell).toHaveBeenCalledWith('rec_1', 'Product', 'Gaming Keyboard');
  });

  it('performs data cleaning remove duplicates and supports undo', async () => {
    const user = userEvent.setup();
    const duplicateRecords: ExtractedRecord[] = [
      { _id: '1', _page: 1, _extractedAt: 100, Product: 'Laptop', Price: 1000, Category: 'Tech' },
      { _id: '2', _page: 1, _extractedAt: 200, Product: 'Laptop', Price: 1000, Category: 'Tech' },
    ];

    render(<DataTable records={duplicateRecords} fields={sampleFields} />);

    expect(screen.getByText('2 records')).toBeInTheDocument();

    const removeDupBtn = screen.getByRole('button', { name: /remove duplicates/i });
    await user.click(removeDupBtn);

    // Confirm dialog appears
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    await user.click(confirmBtn);

    // Now 1 record
    expect(screen.getByText('1 records')).toBeInTheDocument();

    // Click Undo
    const undoBtn = screen.getByRole('button', { name: /undo/i });
    await user.click(undoBtn);

    // Back to 2 records
    expect(screen.getByText('2 records')).toBeInTheDocument();
  });
});
