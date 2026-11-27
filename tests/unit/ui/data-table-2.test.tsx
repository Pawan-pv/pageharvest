import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('UI: Data Table 2.0', () => {
  const fields: FieldDefinition[] = [
    { id: 'f_name', name: 'Name', selector: '.name', extractor: 'text' },
    { id: 'f_image', name: 'Image', selector: '.image', extractor: 'src' },
    { id: 'f_link', name: 'Link', selector: '.link', extractor: 'href' },
  ];

  const records: ExtractedRecord[] = [
    { _id: 'r1', _page: 1, _extractedAt: 1, Name: '  Alice  ', Image: 'https://example.com/a.png', Link: 'https://example.com/a' },
    { _id: 'r2', _page: 1, _extractedAt: 2, Name: 'Alice', Image: 'https://example.com/a.png', Link: 'https://example.com/a' },
    { _id: 'r3', _page: 1, _extractedAt: 3, Name: '', Image: '', Link: '' },
    { _id: 'r4', _page: 1, _extractedAt: 4, Name: 'Bob', Image: '', Link: '' },
  ];

  const dataset: Dataset = {
    id: 'ds_1',
    name: 'Product List',
    url: 'https://shop.example.com',
    recordsCount: 4,
    fields,
    createdAt: 1,
    updatedAt: 1,
  };

  const allDatasets = [dataset, { ...dataset, id: 'ds_2', name: 'Other List' }];

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders the Open Full Table button and calls the handler when not full-page', () => {
    const onOpenFullTable = vi.fn();
    render(
      <DataTable
        dataset={dataset}
        records={records}
        fields={fields}
        fullPage={false}
        datasets={allDatasets}
        onOpenFullTable={onOpenFullTable}
      />
    );

    expect(screen.getByRole('button', { name: /Open Full Table/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open Full Table/ }));
    expect(onOpenFullTable).toHaveBeenCalledTimes(1);
  });

  it('hides the Open Full Table button in full-page mode', () => {
    render(
      <DataTable
        dataset={dataset}
        records={records}
        fields={fields}
        fullPage
        datasets={allDatasets}
      />
    );

    expect(screen.queryByRole('button', { name: /Open Full Table/ })).not.toBeInTheDocument();
  });

  it('shows Smart Clean and Merge columns buttons and runs Smart Clean', () => {
    render(
      <DataTable
        dataset={dataset}
        records={records}
        fields={fields}
      />
    );

    expect(screen.getByRole('button', { name: /Smart Clean/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Merge columns/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Smart Clean/ }));

    // Smart Clean trims whitespace, drops the empty row and the duplicate, then reports a summary.
    expect(
      screen.getByText(/Smart Clean: trimmed 1 cell, removed 1 empty row, removed 1 duplicate\./)
    ).toBeInTheDocument();
  });

  it('shows the Send URLs to Tool button when a URL column is detected', () => {
    render(
      <DataTable
        dataset={dataset}
        records={records}
        fields={fields}
      />
    );

    expect(screen.getByRole('button', { name: /Send URLs to Tool/ })).toBeInTheDocument();
  });

  it('switches to the image gallery when an image column is detected', () => {
    render(
      <DataTable
        dataset={dataset}
        records={records}
        fields={fields}
      />
    );

    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gallery' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));

    // The gallery renders the image column values as pictures.
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images.every((img) => img.getAttribute('src')?.includes('example.com'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('renders the dataset header in full-page mode', () => {
    render(
      <DataTable
        dataset={dataset}
        records={records}
        fields={fields}
        fullPage
        datasets={allDatasets}
      />
    );

    expect(screen.getByText('Product List')).toBeInTheDocument();
    expect(screen.getByText('4 records')).toBeInTheDocument();
    expect(screen.getByText('3 columns')).toBeInTheDocument();
  });
});
