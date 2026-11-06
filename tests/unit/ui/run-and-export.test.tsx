import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtractionProgressView } from '@/components/dashboard/ExtractionProgressView';
import { ExportDialog } from '@/components/grid/ExportDialog';
import type { ExtractionStats } from '@/hooks/useExtractionWorkflow';
import type { ExtractedRecord, FieldDefinition } from '@/types';

const running: ExtractionStats = {
  progressKind: 'pages',
  currentStep: 3,
  targetSteps: 20,
  totalExtracted: 140,
  duplicatesSkipped: 6,
  recordsDetected: 150,
  recordsWithMissingFields: 3,
  recordsFiltered: 4,
  recordsFailed: 0,
  elapsedSeconds: 42,
  status: 'RUNNING',
};

function progress(stats: Partial<ExtractionStats> = {}) {
  const handlers = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onCancel: vi.fn() };
  render(<ExtractionProgressView stats={{ ...running, ...stats }} {...handlers} />);
  return handlers;
}

describe('Run screen', () => {
  it('reports progress as a sentence and as a labelled progress bar', () => {
    progress();
    expect(screen.getByText('Page 3 of 20, 140 rows so far')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Extraction progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '15');
    expect(bar).toHaveAttribute('aria-valuetext', 'Page 3 of 20, 140 rows so far');
  });

  it('leaves the bar indeterminate when the total is unknown', () => {
    progress({ targetSteps: 1, currentStep: 4 });
    expect(screen.getByText('Page 4, 140 rows so far')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('counts rows, duplicates skipped and rows excluded, with help for the last two', () => {
    progress();
    expect(screen.getByText('Rows saved').nextSibling).toHaveTextContent('140');
    expect(screen.getByText('Duplicates skipped').nextSibling).toHaveTextContent('6');
    expect(screen.getByText('Rows excluded').nextSibling).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: 'Help: Duplicates skipped' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help: Required columns' })).toBeInTheDocument();
  });

  it('says that closing the panel does not stop the job', () => {
    progress();
    expect(screen.getByText(/You can close this panel. The job keeps running/)).toBeInTheDocument();
  });

  it('does not show a raw status code', () => {
    progress();
    expect(screen.queryByText('RUNNING')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Collecting rows…' })).toBeInTheDocument();
  });

  it('explains what Finish and Cancel each do', async () => {
    const { onStop, onCancel } = progress();
    const finish = screen.getByRole('button', { name: 'Finish and view rows' });
    const cancel = screen.getByRole('button', { name: 'Cancel job' });
    expect(finish).toHaveAccessibleDescription(/shows the rows collected so far/);
    expect(cancel).toHaveAccessibleDescription(/saved rows stay in Datasets/);
    expect(screen.getByRole('button', { name: 'Help: Finish or Cancel' })).toBeInTheDocument();

    await userEvent.click(finish);
    expect(onStop).toHaveBeenCalled();
    await userEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();
  });

  it('explains a failure with its code', () => {
    progress({ status: 'FAILED', errorCode: 'PAGINATION_TIMEOUT', errorMessage: 'net::ERR_TIMED_OUT' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The next page did not open');
    expect(alert).toHaveTextContent('Your data: Rows from earlier pages are saved.');
    expect(screen.queryByText(/You can close this panel/)).not.toBeInTheDocument();
  });
});

const fields: FieldDefinition[] = [
  { id: 'a', name: 'Title', selector: '.t', extractor: 'text' },
  { id: 'b', name: 'Price', selector: '.p', extractor: 'number' },
];
const records: ExtractedRecord[] = [
  { _id: '1', _page: 1, _extractedAt: 1, Title: 'A', Price: 1 },
  { _id: '2', _page: 1, _extractedAt: 1, Title: '=SUM(1)', Price: 2 },
  { _id: '3', _page: 1, _extractedAt: 1, Title: 'C', Price: 3 },
];

async function openExport() {
  render(<ExportDialog isOpen onClose={vi.fn()} records={records} fields={fields} />);
  // Let the saved export preferences load.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe('Export dialog', () => {
  it('is a labelled dialog that says how many rows and columns will be exported', async () => {
    await openExport();
    const dialog = screen.getByRole('dialog', { name: 'Export data' });
    expect(dialog).toHaveAccessibleDescription('3 rows × 2 columns will be exported.');
  });

  it('offers CSV, JSON and NDJSON as described radios', async () => {
    await openExport();
    const group = screen.getByRole('group', { name: 'Format' });
    expect(within(group).getByRole('radio', { name: 'CSV' })).toHaveAccessibleDescription(/Excel/);
    expect(within(group).getByRole('radio', { name: 'JSON' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'NDJSON' })).toBeInTheDocument();
  });

  it('for CSV, offers a delimiter, an Excel tip, and says formula-like cells are protected', async () => {
    await openExport();
    await userEvent.click(screen.getByRole('radio', { name: 'CSV' }));
    expect(screen.getByLabelText('Delimiter')).toHaveAccessibleDescription(/Semicolon/);
    expect(screen.getByText(/start like a formula/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    expect(screen.queryByLabelText('Delimiter')).not.toBeInTheDocument();
    expect(screen.queryByText(/start like a formula/)).not.toBeInTheDocument();
  });

  it('keeps keyboard focus inside and returns it on close', async () => {
    const user = userEvent.setup();
    await openExport();
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 15; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
