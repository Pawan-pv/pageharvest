import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describeProgress, formatRows } from '@/components/dashboard/progress-copy';
import { describeError, ERROR_COPY } from '@/components/common/errorCopy';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { Stepper } from '@/components/common/Stepper';
import { flowSteps, stepForView, type FlowKind } from '@/components/shell/flow';
import { RecoveryBanner } from '@/components/shell/RecoveryBanner';
import { ExtractionErrorCodeSchema } from '@/shared/contracts/error';
import { ExtractionJobSchema, type ExtractionJob } from '@/shared/contracts/job';
import App from '../../../entrypoints/sidepanel/App';
import { db } from '@/storage/db';
import { installBackground, makeRecipe } from '../../utils/job-harness';

describe('describeProgress', () => {
  it('shows the total only when it is known', () => {
    expect(describeProgress({ kind: 'pages', step: 3, total: 20, rows: 140 })).toEqual({
      stepLabel: 'Page 3 of 20',
      summary: 'Page 3 of 20, 140 rows so far',
      percent: 15,
    });
    expect(describeProgress({ kind: 'pages', step: 3, rows: 140 })).toEqual({
      stepLabel: 'Page 3',
      summary: 'Page 3, 140 rows so far',
      percent: null,
    });
  });

  it('does the same for scroll jobs', () => {
    expect(describeProgress({ kind: 'scrolls', step: 6, total: 30, rows: 45 }).summary).toBe(
      'Scroll 6 of 30, 45 rows so far'
    );
    expect(describeProgress({ kind: 'scrolls', step: 6, rows: 45 }).summary).toBe('Scroll 6, 45 rows so far');
  });

  it('treats a total smaller than the current step as unknown', () => {
    // Older stored jobs have no target; the panel reads that as 1.
    expect(describeProgress({ kind: 'pages', step: 4, total: 1, rows: 9 }).summary).toBe('Page 4, 9 rows so far');
  });

  it('describes a single-page job without steps', () => {
    expect(describeProgress({ kind: 'single', step: 1, total: 1, rows: 1 })).toEqual({
      stepLabel: 'This page',
      summary: 'This page, 1 row so far',
      percent: null,
    });
  });

  it('formats row counts', () => {
    expect(formatRows(1)).toBe('1 row');
    expect(formatRows(12500)).toBe('12,500 rows');
  });
});

describe('describeError', () => {
  const codes = ExtractionErrorCodeSchema.options;

  it.each(codes)('has a full human explanation for %s', (code) => {
    const copy = ERROR_COPY[code];
    for (const part of [copy.title, copy.whatHappened, copy.dataSafety, copy.nextStep]) {
      expect(part.trim().length).toBeGreaterThan(0);
      expect(part).not.toContain(code);
      expect(part).not.toMatch(/\b[A-Z]+_[A-Z_]+\b/);
    }
  });

  it('looks up copy by code, keeping the raw message as detail', () => {
    const result = describeError({ code: 'TAB_DISCONNECTED', message: 'Receiving end does not exist.' });
    expect(result.title).toBe(ERROR_COPY.TAB_DISCONNECTED.title);
    expect(result.details).toBe('TAB_DISCONNECTED: Receiving end does not exist.');
  });

  it('falls back to a generic sentence for a missing or unknown code, never reading the message', () => {
    const generic = describeError({ message: 'The page stopped responding during extraction.' });
    expect(generic.title).toBe(ERROR_COPY.UNKNOWN_ERROR.title);
    expect(generic.details).toBe('The page stopped responding during extraction.');

    // A message that names a known code must not be used to pick the copy.
    expect(describeError({ message: 'TAB_DISCONNECTED' }).title).toBe(ERROR_COPY.UNKNOWN_ERROR.title);
    expect(describeError({ code: 'NOT_A_CODE', message: 'x' }).title).toBe(ERROR_COPY.UNKNOWN_ERROR.title);
  });

  it('renders what happened, data safety and next step, with details collapsed', () => {
    render(<ErrorBanner error={{ code: 'STORAGE_ERROR', message: 'QuotaExceededError' }} />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(ERROR_COPY.STORAGE_ERROR.title);
    expect(banner).toHaveTextContent(`Your data: ${ERROR_COPY.STORAGE_ERROR.dataSafety}`);
    expect(banner).toHaveTextContent(`What to do: ${ERROR_COPY.STORAGE_ERROR.nextStep}`);
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');
  });
});

describe('flow steps', () => {
  it.each<[FlowKind, string]>([
    ['pick', 'Pick data'],
    ['auto', 'Find data'],
    ['table', 'Find a table'],
    ['links', 'Find links'],
    ['recipe', 'Load recipe'],
  ])('names the first step for the %s flow', (kind, label) => {
    const steps = flowSteps(kind);
    expect(steps.map((step) => step.id)).toEqual(['pick', 'fields', 'pagination', 'run', 'export']);
    expect(steps[0].label).toBe(label);
    expect(steps.find((step) => step.id === 'pagination')?.optional).toBe(true);
  });

  it('maps panel views to steps, and non-flow views to none', () => {
    expect(stepForView('inspecting')).toBe('pick');
    expect(stepForView('review_list')).toBe('pick');
    expect(stepForView('config_fields')).toBe('fields');
    expect(stepForView('extracting')).toBe('run');
    expect(stepForView('results')).toBe('export');
    expect(stepForView('dashboard')).toBeNull();
    expect(stepForView('history')).toBeNull();
    expect(stepForView('settings')).toBeNull();
  });
});

describe('Stepper', () => {
  it('marks the current step, says where the user is, and labels finished steps', () => {
    render(<Stepper steps={flowSteps('auto')} currentId="fields" />);
    const nav = screen.getByRole('navigation', { name: 'Extraction steps' });
    expect(nav).toHaveTextContent('Step 2 of 5: Review fields');

    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('Find data (done)');
    expect(items[2]).toHaveTextContent('Pagination (optional)');
    expect(items[0]).not.toHaveAttribute('aria-current');
  });
});

function makeJob(overrides: Partial<ExtractionJob> = {}): ExtractionJob {
  return ExtractionJobSchema.parse({
    id: 'job_1',
    projectId: 'p',
    datasetId: 'd',
    runId: 'r',
    generation: 'g',
    targetUrl: 'https://shop.example.com/items?page=1',
    schema: makeRecipe({ type: 'next_button' }),
    status: 'RECOVERABLE',
    progressKind: 'pages',
    targetSteps: 10,
    pagesVisited: 3,
    totalExtracted: 45,
    interruptedReason: 'The tab running this extraction was closed.',
    ...overrides,
  });
}

describe('RecoveryBanner', () => {
  it('says where it stopped, why, and how many rows are safe', () => {
    render(<RecoveryBanner job={makeJob()} onResume={vi.fn()} onDiscard={vi.fn()} />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Extraction interrupted');
    expect(banner).toHaveTextContent('The extraction on shop.example.com stopped at page 3 of 10.');
    expect(banner).toHaveTextContent('The tab running this extraction was closed.');
    expect(banner).toHaveTextContent('Your data: 45 rows saved and safe.');
    expect(screen.getByRole('button', { name: 'Help: Interrupted extractions' })).toBeInTheDocument();
  });

  it('resumes straight away', async () => {
    const onResume = vi.fn();
    render(<RecoveryBanner job={makeJob()} onResume={onResume} onDiscard={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledWith('job_1');
  });

  it('offers Allow access and resume when the job stopped for missing site access', async () => {
    const onResume = vi.fn();
    const job = makeJob({
      interruptedReason: 'PageHarvest needs access to this site to continue. Allow access?',
      errors: [
        {
          id: 'e1',
          category: 'RUNTIME_MESSAGING',
          code: 'SITE_PERMISSION_REQUIRED',
          message: 'PageHarvest needs access to this site to continue. Allow access?',
          severity: 'WARN',
          timestamp: 1,
        },
      ],
    } as Partial<ExtractionJob>);
    render(<RecoveryBanner job={job} onResume={onResume} onDiscard={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Allow access and resume' }));
    expect(onResume).toHaveBeenCalledWith('job_1');
  });

  it('asks before discarding, and says the saved rows are kept', async () => {
    const onDiscard = vi.fn();
    render(<RecoveryBanner job={makeJob()} onResume={vi.fn()} onDiscard={onDiscard} />);

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard this interrupted job?' });
    expect(dialog).toHaveTextContent('Its 45 saved rows stay in Datasets');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(onDiscard).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard job' }));
    expect(onDiscard).toHaveBeenCalledWith('job_1');
  });

  it('reports scroll jobs in scrolls, and an unknown total without one', () => {
    render(
      <RecoveryBanner
        job={makeJob({ progressKind: 'scrolls', scrollsCompleted: 6, targetSteps: undefined })}
        onResume={vi.fn()}
        onDiscard={vi.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('stopped at scroll 6.');
  });
});

describe('App shell', () => {
  beforeEach(async () => {
    await db.clearAllData();
    installBackground(db);
  });

  it('marks the current section in the main navigation', async () => {
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('button', { name: 'Harvest' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav).getByRole('button', { name: 'Datasets' }));
    expect(within(nav).getByRole('button', { name: 'Datasets' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Harvest' })).not.toHaveAttribute('aria-current');
  });

  it('shows no steps on the dashboard', async () => {
    render(<App />);
    await screen.findByText('Get data from this page');
    await screen.findByText('PageHarvest');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Extraction steps' })).not.toBeInTheDocument());
  });

  it('shows the Table flow with its own first step and a scanning state, not the picker', async () => {
    render(<App />);
    await userEvent.click(await screen.findByText('More ways to start'));
    await userEvent.click(screen.getByRole('button', { name: /Extract a table/ }));

    const steps = await screen.findByRole('navigation', { name: 'Extraction steps' });
    expect(steps).toHaveTextContent('Step 1 of 5: Find a table');
    expect(await screen.findByText('Looking for tables on this page…')).toBeInTheDocument();
  });
});
