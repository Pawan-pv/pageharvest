import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../entrypoints/sidepanel/App';
import { LibraryView } from '@/components/library/LibraryView';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { ExtractionProgressView } from '@/components/dashboard/ExtractionProgressView';
import { ERROR_COPY } from '@/components/common/errorCopy';
import { statsFromJob } from '@/hooks/useExtractionWorkflow';
import { codeForCategory } from '@/core/resilience/error-reporter';
import { HarvestErrorSchema } from '@/shared/contracts/error';
import { ExtractionJobSchema, type ExtractionJob } from '@/shared/contracts/job';
import { JobRepository, HistoryRepository } from '@/storage/repositories';
import { db } from '@/storage/db';
import { installBackground, makeRecipe } from '../utils/job-harness';

/**
 * Data written before ADR-031: HarvestError had no `code`. Rows are written straight into
 * IndexedDB as plain objects, the way an older build left them, then read by the current UI.
 */
function legacyError(category: string, message: string) {
  return { id: `err_${category}`, category, severity: 'ERROR', message, timestamp: 1_700_000_000_000 };
}

function legacyJob(overrides: Record<string, unknown>): Record<string, unknown> {
  const parsed = ExtractionJobSchema.parse({
    id: 'job_legacy',
    projectId: 'project_1',
    datasetId: 'dataset_1',
    runId: 'run_1',
    generation: 'gen_1',
    targetUrl: 'https://shop.example.com/items',
    schema: makeRecipe({ type: 'next_button' }),
    status: 'FAILED',
    progressKind: 'pages',
    targetSteps: 10,
    pagesVisited: 4,
    totalExtracted: 37,
    startedAt: 1_700_000_000_000,
    ...overrides,
  });
  // A plain copy, exactly as stored: no `code` on any error.
  return JSON.parse(JSON.stringify(parsed));
}

async function seed() {
  await db.jobs.put(
    legacyJob({
      id: 'job_failed',
      errorMessage: 'QuotaExceededError: the disk is full',
      errors: [legacyError('STORAGE_FAILED', 'QuotaExceededError: the disk is full')],
    }) as unknown as ExtractionJob
  );
  await db.jobs.put(
    legacyJob({
      id: 'job_recoverable',
      status: 'RECOVERABLE',
      interruptedReason: 'The tab running this extraction was closed.',
      errors: [legacyError('RUNTIME_MESSAGING', 'The tab running this extraction was closed.')],
    }) as unknown as ExtractionJob
  );
  await db.checkpoints.put({
    jobId: 'job_recoverable',
    startUrl: 'https://shop.example.com/items',
    currentUrl: 'https://shop.example.com/items?page=4',
    awaitingNavigation: false,
    nextPage: 5,
    scrollsCompleted: 0,
    catchUpScrolls: 0,
    visitedUrls: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 86_400_000,
  });
  await db.history.put({
    id: 'history_legacy',
    jobId: 'job_failed',
    datasetId: 'dataset_1',
    name: 'Legacy shop run',
    url: 'https://shop.example.com/items',
    status: 'FAILED',
    totalExtracted: 37,
    duplicatesSkipped: 2,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_060_000,
    errorMessage: 'QuotaExceededError: the disk is full',
  });
}

describe('Error records stored before ADR-031', () => {
  beforeEach(async () => {
    await db.clearAllData();
    installBackground(db);
    await seed();
  });

  it('are stored without a code, and still read and validate', async () => {
    const raw = await db.jobs.get('job_failed');
    expect(raw?.errors[0]).not.toHaveProperty('code');

    const job = await new JobRepository().getJob('job_failed');
    expect(job?.errors).toHaveLength(1);
    for (const error of job?.errors ?? []) expect(() => HarvestErrorSchema.parse(error)).not.toThrow();
    expect(await new HistoryRepository().getAllHistory()).toHaveLength(1);
  });

  it('get the default code for their category when the panel reads them', async () => {
    const job = (await new JobRepository().getJob('job_failed')) as ExtractionJob;
    const stats = statsFromJob(job);
    expect(stats.errorCode).toBe(codeForCategory('STORAGE_FAILED'));
    expect(stats.errorCode).toBe('STORAGE_ERROR');

    const recoverable = (await new JobRepository().getJob('job_recoverable')) as ExtractionJob;
    expect(statsFromJob(recoverable).errorCode).toBe('TAB_DISCONNECTED');
  });

  it('are explained by ErrorBanner with the category default, not the generic copy', async () => {
    const job = (await new JobRepository().getJob('job_failed')) as ExtractionJob;
    const stats = statsFromJob(job);
    render(<ErrorBanner error={{ code: stats.errorCode, message: stats.errorMessage }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(ERROR_COPY.STORAGE_ERROR.title);
    expect(alert).not.toHaveTextContent(ERROR_COPY.UNKNOWN_ERROR.title);
  });

  it('show on the run screen of a failed job', async () => {
    const job = (await new JobRepository().getJob('job_failed')) as ExtractionJob;
    render(
      <ExtractionProgressView
        stats={statsFromJob(job)}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_COPY.STORAGE_ERROR.title);
  });

  it('let the panel open with its recovery banner', async () => {
    render(<App />);
    expect(await screen.findByText('Extraction interrupted')).toBeInTheDocument();
    expect(screen.getByText(/stopped at page 4 of 10/)).toBeInTheDocument();
    expect(screen.getByText(/37 rows saved and safe/)).toBeInTheDocument();
  });

  it('let Run History list the failed run with its message', async () => {
    render(
      <LibraryView
        datasets={[]}
        onViewDataset={vi.fn()}
        onDeleteDataset={vi.fn()}
        onGetDatasetRecords={vi.fn().mockResolvedValue([])}
        onNewExtraction={vi.fn()}
        onRunRecipe={vi.fn()}
        onUseSchema={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Run History' }));
    expect(await screen.findByText('Legacy shop run')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('QuotaExceededError: the disk is full')).toBeInTheDocument());
  });
});
