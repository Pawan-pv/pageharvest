import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../../entrypoints/sidepanel/App';
import { ExtractionJobSchema } from '@/shared/contracts/job';
import { db } from '@/storage/db';
import { installBackground, makeRecipe } from '../../utils/job-harness';

const JOB_ID = 'job_recovered_1';

/** Stores a really interrupted job: the same rows the coordinator would have left behind. */
async function storeRecoverableJob(overrides: Record<string, unknown> = {}) {
  await db.jobs.put(
    ExtractionJobSchema.parse({
      id: JOB_ID,
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
    })
  );
  await db.checkpoints.put({
    jobId: JOB_ID,
    startUrl: 'https://example.com/shop',
    currentUrl: 'https://example.com/shop?page=3',
    awaitingNavigation: false,
    nextPage: 4,
    scrollsCompleted: 0,
    catchUpScrolls: 0,
    visitedUrls: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 86_400_000,
  });
}

describe('UI: App Container & Navigation Lifecycle', () => {
  beforeEach(async () => {
    await db.clearAllData();
    installBackground(db);
  });

  it('renders App shell with header, title, and navigation tabs', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('PageHarvest')).toBeInTheDocument();
      expect(screen.getByText('v1.0')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Harvest' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Datasets' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    });
  });

  it('shows no recovery banner when nothing can be recovered', async () => {
    render(<App />);

    await screen.findByText('Get data from this page');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByText('Extraction interrupted')).not.toBeInTheDocument();
  });

  it('displays the recovery banner for a stored recoverable job, with its real progress', async () => {
    await storeRecoverableJob();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Extraction interrupted')).toBeInTheDocument();
      expect(screen.getByText(/stopped at page 3 of 10/)).toBeInTheDocument();
      expect(screen.getByText(/45 rows saved and safe/)).toBeInTheDocument();
      expect(screen.getByText(/tab running this extraction was closed/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('reports scroll jobs in scrolls on the banner', async () => {
    await storeRecoverableJob({ progressKind: 'scrolls', scrollsCompleted: 6, pagesVisited: 7 });
    render(<App />);

    expect(await screen.findByText(/stopped at scroll 6 of 10/)).toBeInTheDocument();
  });

  it('discards the session through the background, ending the job for good', async () => {
    await storeRecoverableJob();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    // Discarding asks first, and says the saved rows are kept.
    fireEvent.click(await screen.findByRole('button', { name: 'Discard job' }));

    await waitFor(() => {
      expect(screen.queryByText('Extraction interrupted')).not.toBeInTheDocument();
    });
    expect((await db.jobs.get(JOB_ID))?.status).toBe('CANCELLED');
    expect(await db.checkpoints.get(JOB_ID)).toBeUndefined();
    expect(await db.history.where('jobId').equals(JOB_ID).count()).toBe(1);
  });

  it('resumes the session through the background and follows the job', async () => {
    await storeRecoverableJob();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    await waitFor(async () => {
      expect((await db.jobs.get(JOB_ID))?.status).toBe('RUNNING');
    });
    expect(await screen.findByText('Harvesting in Progress...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Extraction interrupted')).not.toBeInTheDocument();
    });
  });

  it('switches views when clicking Datasets and Settings navigation tabs', async () => {
    render(<App />);

    // Click Datasets
    fireEvent.click(screen.getByRole('button', { name: 'Datasets' }));
    await waitFor(() => expect(screen.getByText('Saved Extractions')).toBeInTheDocument());

    // Click Settings
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByText('Settings & Preferences')).toBeInTheDocument());

    // Return to Harvest
    fireEvent.click(screen.getByRole('button', { name: 'Harvest' }));
    await waitFor(() => expect(screen.getByText('Get data from this page')).toBeInTheDocument());
  });
});
