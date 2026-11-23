import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobCoordinator } from '@/background/job-coordinator';
import { SimpleMyData } from '@/components/simple/MyData';
import { ExtractionHistoryView } from '@/components/history/ExtractionHistoryView';
import { useDatasets } from '@/hooks/useDatasets';
import { db } from '@/storage/db';
import { BASE_URL, installBackground, makeRecipe } from '../../utils/job-harness';

/**
 * "My data" lists a job's list from the moment the job starts. Deleting it while the job
 * can still write is refused by storage (see tests/integration/dataset-edit-races.test.ts);
 * this checks the person is told why, in the panel, with the real hook and real storage.
 */
async function startRunningJob(): Promise<{ jobId: string; datasetId: string }> {
  const coordinator = new JobCoordinator({
    db,
    transport: {
      sendToTab: async () => ({ accepted: true }),
      broadcast: async () => undefined,
      openBlankTab: async () => 900,
      navigateTab: async () => undefined,
      getTabLoadStatus: async () => 'complete',
      injectContentScript: async () => ({ injected: false, url: BASE_URL }),
    },
    checkPermissions: async () => ({ allGranted: true, missing: [] }),
    reporter: { report: (category, error) => ({ id: 'e', category, severity: 'ERROR', message: String(error), timestamp: 0 }) },
  });
  const result = await coordinator.startJob({
    recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 5 }),
    tabId: 4,
    sourceUrl: `${BASE_URL}/books`,
  });
  if (!result.ok || !result.identity) throw new Error(String(result.error));
  return { jobId: result.identity.jobId, datasetId: result.identity.datasetId };
}

function SimpleScreen() {
  const { datasets, deleteDataset, getDatasetRecords } = useDatasets();
  return (
    <SimpleMyData
      datasets={datasets}
      onViewDataset={() => undefined}
      onDeleteDataset={deleteDataset}
      onGetDatasetRecords={getDatasetRecords}
      onNewExtraction={() => undefined}
    />
  );
}

function AdvancedScreen() {
  const { datasets, deleteDataset, getDatasetRecords } = useDatasets();
  return (
    <ExtractionHistoryView
      datasets={datasets}
      onViewDataset={() => undefined}
      onDeleteDataset={deleteDataset}
      onGetDatasetRecords={getDatasetRecords}
      onNewExtraction={() => undefined}
    />
  );
}

beforeEach(() => {
  // Deletes and renames go through the background, the only writer.
  installBackground(db);
});

afterEach(async () => {
  await db.clearAllData();
});

describe('Deleting a list that is still being collected', () => {
  it('tells a simple-mode user why it was not deleted and what to do, and keeps the list', async () => {
    const { datasetId } = await startRunningJob();
    render(<SimpleScreen />);

    const name = await screen.findByText('Test extraction');
    await userEvent.click(screen.getByRole('button', { name: 'Delete Test extraction' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    const banner = (await screen.findByText('Not deleted yet')).closest('[role]') as HTMLElement;
    // The reason is the next step itself, not hidden under Technical details.
    expect(within(banner).getByText('This list is still being collected. Stop it first, then delete it.')).toBeVisible();
    expect(within(banner).getByText('Nothing was changed.')).toBeInTheDocument();
    expect(within(banner).queryByText('Technical details')).not.toBeInTheDocument();
    expect(name).toBeInTheDocument();
    expect(await db.datasets.get(datasetId)).toBeDefined();
  });

  it('gives the same reason in the detailed list under Advanced options', async () => {
    await startRunningJob();
    render(<AdvancedScreen />);

    await screen.findByText('Test extraction');
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Delete/ }));

    await waitFor(() =>
      expect(screen.getByText(/This list is still being collected\. Stop it first, then delete it\./)).toBeInTheDocument()
    );
  });

  it('deletes it once the job has ended', async () => {
    const { jobId, datasetId } = await startRunningJob();
    await db.jobs.update(jobId, { status: 'COMPLETED' });
    render(<SimpleScreen />);

    await screen.findByText('Test extraction');
    await userEvent.click(screen.getByRole('button', { name: 'Delete Test extraction' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Test extraction')).not.toBeInTheDocument());
    expect(await db.datasets.get(datasetId)).toBeUndefined();
  });
});
