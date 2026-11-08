import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FieldPreview } from '@/components/picker/FieldPreview';
import { ERROR_COPY } from '@/components/common/errorCopy';
import type { FieldPreviewResult } from '@/shared/contracts/message';
import type { FieldDefinition } from '@/types';

const title: FieldDefinition = { id: 't', name: 'Title', selector: '.t', extractor: 'text' };
const price: FieldDefinition = { id: 'p', name: 'Price', selector: '.p', extractor: 'number' };
const samples = ['Alpha £3', 'Beta £4'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Live field preview', () => {
  it('shows real cell values per column from the page', async () => {
    const onPreview = vi.fn(
      async (): Promise<FieldPreviewResult> => ({
        ok: true,
        rows: [
          { Title: 'Alpha', Price: 3 },
          { Title: 'Beta', Price: null },
        ],
        matchCount: 24,
        usedFallback: false,
      })
    );
    render(<FieldPreview columns={[title, price]} samples={samples} onPreview={onPreview} />);

    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(await within(preview).findByText('Live from the page')).toBeInTheDocument();
    const rows = within(preview).getAllByRole('row');
    expect(within(rows[1]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Alpha', '3']);
    expect(within(rows[2]).getAllByRole('cell')[1]).toHaveTextContent('—');
    expect(within(preview).getByText(/First 2 of 24 items/)).toBeInTheDocument();
    expect(onPreview).toHaveBeenCalledWith([title, price]);
  });

  it('asks again when the columns change and ignores an answer that arrives late', async () => {
    const first = deferred<FieldPreviewResult>();
    const onPreview = vi
      .fn<(columns: FieldDefinition[]) => Promise<FieldPreviewResult>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, rows: [{ Cost: 3 }], matchCount: 1, usedFallback: false });

    const { rerender } = render(<FieldPreview columns={[price]} samples={samples} onPreview={onPreview} />);
    await vi.waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    rerender(<FieldPreview columns={[{ ...price, name: 'Cost' }]} samples={samples} onPreview={onPreview} />);
    expect(await screen.findByRole('columnheader', { name: 'Cost' })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: '3' })).toBeInTheDocument();

    // The first request finishes after the second: its rows must not replace the newer ones.
    first.resolve({ ok: true, rows: [{ Price: 999 }], matchCount: 1, usedFallback: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  it('explains a failed preview and falls back to the detection sample', async () => {
    const onPreview = vi.fn(
      async (): Promise<FieldPreviewResult> => ({
        ok: false,
        code: 'CONTAINER_NOT_FOUND',
        message: 'The list is no longer on this page.',
      })
    );
    render(<FieldPreview columns={[title]} samples={samples} onPreview={onPreview} />);

    expect(await screen.findByText(ERROR_COPY.CONTAINER_NOT_FOUND.title)).toBeInTheDocument();
    expect(screen.getByText('Sample from detection')).toBeInTheDocument();
    expect(screen.getByText('Alpha £3')).toBeInTheDocument();
  });

  it('labels rows found with the backup, blocks running, and offers picking the list again', async () => {
    const onDriftChange = vi.fn();
    const onPickListAgain = vi.fn();
    const onPreview = vi.fn(
      async (): Promise<FieldPreviewResult> => ({
        ok: true,
        rows: [{ Title: 'Alpha' }],
        matchCount: 3,
        usedFallback: true,
      })
    );
    render(
      <FieldPreview
        columns={[title]}
        samples={samples}
        onPreview={onPreview}
        onDriftChange={onDriftChange}
        onPickListAgain={onPickListAgain}
      />
    );

    expect(await screen.findByText('Found with a backup')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(
      screen.getByText("The page layout changed. A run wouldn't find this list yet. Pick the list again to continue.")
    ).toBeInTheDocument();
    expect(onDriftChange).toHaveBeenLastCalledWith(true);
    screen.getByRole('button', { name: 'Pick the list again' }).click();
    expect(onPickListAgain).toHaveBeenCalled();
  });

  it('keeps the detection sample when no live preview is wired', () => {
    render(<FieldPreview columns={[title]} samples={samples} />);
    expect(screen.getByText('Sample from detection')).toBeInTheDocument();
  });
});
