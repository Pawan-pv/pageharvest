import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describeError, ERROR_COPY } from '@/components/common/errorCopy';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { DataTable } from '@/components/grid/DataTable';
import { RecoveryBanner } from '@/components/shell/RecoveryBanner';
import { SimpleMyData } from '@/components/simple/MyData';
import { ExtractionErrorCodeSchema } from '@/shared/contracts/error';
import { ExtractionJobSchema } from '@/shared/contracts/job';
import type { Dataset, ExtractedRecord, FieldDefinition } from '@/types';
import { makeRecipe } from '../../utils/job-harness';
import { usePanelMode } from '../../utils/panel-mode';

const FIELDS: FieldDefinition[] = [
  { id: 'a', name: 'Title', selector: 'h3', extractor: 'text' },
  { id: 'b', name: 'Price', selector: '.price', extractor: 'number' },
];

const dataset = (id: string, name: string, rows: number, url = 'https://books.toscrape.com/'): Dataset => ({
  id,
  name,
  url,
  recordsCount: rows,
  fields: FIELDS,
  createdAt: new Date(2026, 10, 12).getTime(),
  updatedAt: new Date(2026, 10, 12).getTime(),
});

const ROWS: ExtractedRecord[] = [
  { _id: 'r1', _page: 1, _extractedAt: 1, Title: 'One', Price: 1 },
  { _id: 'r2', _page: 1, _extractedAt: 1, Title: 'Two', Price: 2 },
];

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:pageharvest-test/1');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderMyData(datasets: Dataset[], props: Partial<React.ComponentProps<typeof SimpleMyData>> = {}) {
  const handlers = {
    onViewDataset: vi.fn(),
    onDeleteDataset: vi.fn().mockResolvedValue(undefined),
    onGetDatasetRecords: vi.fn().mockResolvedValue(ROWS),
    onNewExtraction: vi.fn(),
  };
  const view = render(<SimpleMyData datasets={datasets} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

describe('Simple mode: My data (T4)', () => {
  it('lists what was collected by name, size, site and day, in plain words', () => {
    const { container } = renderMyData([dataset('d1', 'Books - 11/12/2026', 20)]);
    expect(screen.getByRole('heading', { name: 'My data' })).toBeInTheDocument();
    expect(screen.getByText('Books - 11/12/2026')).toBeInTheDocument();
    expect(screen.getByText(/^20 rows from books\.toscrape\.com, /)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/IndexedDB|dataset|extraction|recipe|schema|project|run history/i);
  });

  it('has no other sections: groups, saved setups and history belong to Advanced options', () => {
    renderMyData([dataset('d1', 'Books', 20)]);
    expect(screen.queryByRole('navigation', { name: 'Library sections' })).not.toBeInTheDocument();
    for (const name of ['Projects', 'Recipes', 'Schemas', 'Run History']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('opens a saved list', async () => {
    const books = dataset('d1', 'Books', 20);
    const handlers = renderMyData([books]);
    await userEvent.click(screen.getByRole('button', { name: 'Open Books' }));
    expect(handlers.onViewDataset).toHaveBeenCalledWith(books);
  });

  it('downloads a saved list for Excel and says where the file is', async () => {
    const handlers = renderMyData([dataset('d1', 'Books', 2)]);
    await userEvent.click(screen.getByRole('button', { name: 'Download Books for Excel' }));

    await waitFor(() => expect(chromeMock.downloads.download).toHaveBeenCalledTimes(1));
    expect(handlers.onGetDatasetRecords).toHaveBeenCalledWith('d1');
    expect(chromeMock.downloads.download.mock.calls[0][0].filename).toMatch(/^books-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(await screen.findByText('File saved')).toBeInTheDocument();
  });

  it('asks before deleting, says what is lost, and deletes only on yes', async () => {
    const handlers = renderMyData([dataset('d1', 'Books', 20)]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Books' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete this saved list?' });
    expect(dialog).toHaveTextContent('“Books” and its 20 rows will be removed from this computer.');
    expect(dialog).toHaveTextContent('Files you already downloaded are not touched.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(handlers.onDeleteDataset).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Delete Books' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(handlers.onDeleteDataset).toHaveBeenCalledWith('d1'));
  });

  it('says so when a delete fails, instead of looking as if it worked', async () => {
    renderMyData([dataset('d1', 'Books', 20)], {
      onDeleteDataset: vi.fn().mockRejectedValue(new Error('The database is locked')),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Delete Books' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('That did not work')).toBeInTheDocument();
    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('says what to do when nothing is saved yet', async () => {
    const handlers = renderMyData([]);
    expect(screen.getByText('Nothing saved yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Get a list' }));
    expect(handlers.onNewExtraction).toHaveBeenCalledTimes(1);
  });

  it('shows a search box only when the list is long enough to need one', async () => {
    renderMyData([dataset('d1', 'Books', 20)]);
    expect(screen.queryByRole('textbox', { name: 'Search my data' })).not.toBeInTheDocument();
  });

  it('searches by name or website', async () => {
    const many = ['Books', 'Laptops', 'Phones', 'Chairs', 'Lamps', 'Desks'].map((name, index) =>
      dataset(`d${index}`, name, 10, index === 1 ? 'https://shop.test/laptops' : 'https://books.toscrape.com/')
    );
    renderMyData(many);
    const search = screen.getByRole('textbox', { name: 'Search my data' });
    await userEvent.type(search, 'shop.test');
    expect(screen.getByText('Laptops')).toBeInTheDocument();
    expect(screen.queryByText('Books')).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('Nothing matches "zzz"')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Books')).toBeInTheDocument();
  });
});

describe('Simple mode: the full table', () => {
  function renderTable(props: Partial<React.ComponentProps<typeof DataTable>> = {}) {
    return render(
      <DataTable simple dataset={dataset('d1', 'Books', 2)} records={ROWS} fields={FIELDS} onBack={vi.fn()} {...props} />
    );
  }

  it('shows the rows, a search box and how to change a cell, and no tools', () => {
    const { container } = renderTable({
      runSummary: {
        recordsDetected: 2,
        totalExtracted: 2,
        recordsWithMissingFields: 0,
        recordsFiltered: 0,
        recordsFailed: 0,
        duplicatesSkipped: 0,
      },
    });
    expect(screen.getByRole('heading', { name: 'Books' })).toBeInTheDocument();
    expect(screen.getByText(/2 rows, 2 columns\. Double-click a cell to change it\./)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search these rows' })).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
    for (const name of ['Remove Duplicates', 'Find & Replace', 'Filters', 'Columns', 'Export', 'Normalize']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Extraction summary')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/records|detected|filtered|IndexedDB/i);
  });

  it('goes back to the summary it was opened from', async () => {
    const onBack = vi.fn();
    renderTable({ onBack });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('still lets a cell be changed by double-clicking it', async () => {
    const onUpdateCell = vi.fn();
    renderTable({ onUpdateCell });
    await userEvent.dblClick(screen.getByText('One'));
    const input = await screen.findByDisplayValue('One');
    await userEvent.clear(input);
    await userEvent.type(input, 'Uno{Enter}');
    expect(onUpdateCell).toHaveBeenCalledWith('r1', 'Title', 'Uno');
  });

  it('can take back a deleted row, because the tools that hold Undo are not shown here', async () => {
    const onDeleteRecord = vi.fn().mockResolvedValue(undefined);
    const onRecordsChange = vi.fn().mockResolvedValue(undefined);
    renderTable({ onDeleteRecord, onRecordsChange });
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeDisabled();

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete row' })[0]);
    expect(onDeleteRecord).toHaveBeenCalledWith('r1');
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    // Said once the deletion is stored, with the way back.
    expect(await screen.findByText('Row deleted. Undo brings it back.')).toBeInTheDocument();

    expect(undo).toBeEnabled();
    await userEvent.click(undo);
    expect(await screen.findByText('One')).toBeInTheDocument();
    // The restored rows are written back to storage, not only put back on screen.
    await waitFor(() => expect(onRecordsChange).toHaveBeenCalledTimes(1));
    expect(onRecordsChange.mock.calls[0][0].map((row: ExtractedRecord) => row._id)).toEqual(['r1', 'r2']);
    expect(await screen.findByText('Undone. Your last change was taken back.')).toBeInTheDocument();
  });

  it('keeps every tool when Advanced options is on', () => {
    render(<DataTable dataset={dataset('d1', 'Books', 2)} records={ROWS} fields={FIELDS} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove Duplicates/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });
});

describe('Simple mode: a job that stopped early (T5, R3)', () => {
  const job = (overrides: Record<string, unknown> = {}) =>
    ExtractionJobSchema.parse({
      id: 'job_1',
      projectId: 'project_1',
      datasetId: 'dataset_1',
      runId: 'run_1',
      generation: 'gen_1',
      targetUrl: 'https://example.com/shop',
      schema: makeRecipe({ type: 'next_button' }),
      status: 'RECOVERABLE',
      progressKind: 'pages',
      targetSteps: 10,
      pagesVisited: 3,
      totalExtracted: 45,
      interruptedReason: 'The tab running this extraction was closed.',
      ...overrides,
    });

  it('says what happened in one plain sentence, with the reason under Technical details', () => {
    render(<RecoveryBanner simple job={job()} onResume={vi.fn()} onDiscard={vi.fn()} />);
    const banner = screen.getByRole('status');
    expect(within(banner).getByText('Stopped early')).toBeInTheDocument();
    expect(within(banner).getByText('Collecting from example.com stopped before it finished.')).toBeInTheDocument();
    expect(within(banner).getByText(/45 rows saved and safe/)).toBeInTheDocument();

    // The coordinator's own words are kept, but not as the first thing a beginner reads.
    const details = within(banner).getByText('Technical details').closest('details') as HTMLElement;
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('Stopped at page 3 of 10. The tab running this extraction was closed.');
  });

  it('continues', async () => {
    const onResume = vi.fn();
    render(<RecoveryBanner simple job={job()} onResume={onResume} onDiscard={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onResume).toHaveBeenCalledWith('job_1');
  });

  it('stops for good only after asking, and says the rows are kept', async () => {
    const onDiscard = vi.fn();
    render(<RecoveryBanner simple job={job()} onResume={vi.fn()} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop here and keep my rows' }));

    const dialog = await screen.findByRole('dialog', { name: 'Stop here?' });
    expect(dialog).toHaveTextContent('Your 45 saved rows stay in My data.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(onDiscard).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Stop here and keep my rows' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop here' }));
    expect(onDiscard).toHaveBeenCalledWith('job_1');
  });

  it('offers to allow access when that is what stopped it', () => {
    const blocked = job({
      errors: [
        {
          id: 'e1',
          jobId: 'job_1',
          code: 'SITE_PERMISSION_REQUIRED',
          category: 'RUNTIME_MESSAGING',
          message: 'PageHarvest needs access to this site to continue. Allow access?',
          timestamp: 1,
          severity: 'ERROR',
        },
      ],
    });
    render(<RecoveryBanner simple job={blocked} onResume={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Allow access and continue' })).toBeInTheDocument();
  });

  it('keeps the detailed wording when Advanced options is on', () => {
    render(<RecoveryBanner job={job()} onResume={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText('Extraction interrupted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });
});

describe('Simple mode: what an error tells the user to do (T6)', () => {
  it('never sends a simple-mode user to a control only Advanced options shows, without saying so', () => {
    for (const code of ExtractionErrorCodeSchema.options) {
      const copy = describeError({ code }, { simple: true });
      // "Pagination" and the "Advanced" section of that step do not exist in simple mode.
      expect(copy.nextStep, code).not.toMatch(/under Pagination|Pagination, Advanced|"Page numbers in the URL"/);
      expect(`${copy.title} ${copy.whatHappened} ${copy.nextStep}`, code).not.toMatch(/\bextraction\b/i);
      if (/Advanced options/.test(copy.nextStep)) {
        expect(copy.nextStep, code).toMatch(/Advanced options, in Settings/);
      }
    }
  });

  it('keeps every part an error must have in both modes', () => {
    for (const code of ExtractionErrorCodeSchema.options) {
      for (const simple of [true, false]) {
        const copy = describeError({ code, message: 'detail' }, { simple });
        expect(copy.title.length, code).toBeGreaterThan(3);
        expect(copy.whatHappened.length, code).toBeGreaterThan(3);
        expect(copy.dataSafety.length, code).toBeGreaterThan(3);
        expect(copy.nextStep.length, code).toBeGreaterThan(3);
        expect(copy).not.toHaveProperty('simple');
      }
    }
  });

  it('leaves the wording for Advanced options exactly as it was', () => {
    expect(describeError({ code: 'RATE_LIMITED' }).nextStep).toBe(ERROR_COPY.RATE_LIMITED.nextStep);
    expect(describeError({ code: 'RATE_LIMITED' }, { simple: false }).nextStep).toMatch(/Pagination, Advanced/);
    expect(describeError({ code: 'RATE_LIMITED' }, { simple: true }).nextStep).toBe(
      'Wait a few minutes, then try again with fewer pages.'
    );
  });

  it('follows the Settings switch in every error the panel shows', async () => {
    await usePanelMode('simple');
    const view = render(<ErrorBanner error={{ code: 'RATE_LIMITED', message: 'HTTP 429' }} />);
    expect(screen.getByText(/try again with fewer pages/)).toBeInTheDocument();
    view.unmount();

    await usePanelMode('advanced');
    render(<ErrorBanner error={{ code: 'RATE_LIMITED', message: 'HTTP 429' }} />);
    expect(screen.getByText(/set a longer wait under Pagination, Advanced/)).toBeInTheDocument();
  });
});
