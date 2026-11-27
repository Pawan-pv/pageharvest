import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobCoordinator, JobTransport } from '@/background/job-coordinator';
import { BatchAck, ExtensionMessage } from '@/contracts/messages';
import { JobIdentity } from '@/shared/contracts/job';
import { PageHarvestDB } from '@/storage/db';
import { DatasetRepository } from '@/storage/repositories';
import { BASE_URL, makeBatch, makeRecipe, uniqueDb } from '../utils/job-harness';

/**
 * The side panel edits and deletes saved lists in IndexedDB directly, while the background
 * may still be writing rows to the same list. "My data" lists the running job's dataset
 * from the moment the job starts, with Open and Delete on it.
 *
 * Regression tests for two defects found by the coordinator model test
 * (tests/integration/job-coordinator.model.test.ts):
 * - deleting the list of a job that can still write left the job writing rows into a
 *   dataset that no longer existed: invisible, never counted, never cleaned up;
 * - saving a grid edit replaced the list with the grid's copy, deleting every row the job
 *   committed after the grid read it.
 */
describe('Saved lists that a job is still writing to', () => {
  const TAB = 7;
  let db: PageHarvestDB;
  let coordinator: JobCoordinator;
  let datasets: DatasetRepository;

  // The page accepts every command; its batches are sent by hand below.
  const page: JobTransport = {
    sendToTab: async () => ({ accepted: true }),
    broadcast: async () => undefined,
    openBlankTab: async () => 900,
    navigateTab: async () => undefined,
    getTabLoadStatus: async () => 'complete',
    injectContentScript: async () => ({ injected: false, url: BASE_URL }),
  };

  beforeEach(() => {
    db = uniqueDb();
    datasets = new DatasetRepository(db);
    coordinator = new JobCoordinator({
      db,
      transport: page,
      checkPermissions: async () => ({ allGranted: true, missing: [] }),
      reporter: {
        report: (category, error) => ({
          id: 'err',
          category,
          severity: 'ERROR',
          message: String(error),
          timestamp: 0,
        }),
      },
    });
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  async function startPaginated(): Promise<JobIdentity> {
    const result = await coordinator.startJob({
      recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 10 }),
      tabId: TAB,
      sourceUrl: `${BASE_URL}/list`,
    });
    if (!result.ok || !result.identity) throw new Error(`startJob failed: ${result.error}`);
    return result.identity;
  }

  function commit(identity: JobIdentity, sequence: number, titles: string[]): Promise<BatchAck> {
    const message = makeBatch(identity, sequence, titles) as Extract<ExtensionMessage, { type: 'RECORD_BATCH' }>;
    return coordinator.commitBatch(message.payload, { tabId: TAB });
  }

  async function titles(datasetId: string): Promise<unknown[]> {
    return (await db.getDatasetRecords(datasetId)).map((row) => row.Title);
  }

  it('refuses to delete the list of a running job, and the job keeps writing to it', async () => {
    const identity = await startPaginated();
    await commit(identity, 1, ['One', 'Two']);

    await expect(datasets.deleteDataset(identity.datasetId)).rejects.toThrow(/still being collected/);

    const ack = await commit(identity, 2, ['Three']);
    expect(ack.status).toBe('committed');
    expect(await titles(identity.datasetId)).toEqual(['One', 'Two', 'Three']);
    expect((await db.datasets.get(identity.datasetId))?.recordsCount).toBe(3);
    // No row anywhere points to a list that does not exist.
    const orphans = (await db.records.toArray()).filter((row) => row.datasetId !== identity.datasetId);
    expect(orphans).toEqual([]);
  });

  it('refuses to delete the list of a paused job', async () => {
    const identity = await startPaginated();
    expect((await coordinator.pauseJob(identity.jobId)).ok).toBe(true);
    await expect(datasets.deleteDataset(identity.datasetId)).rejects.toThrow(/still being collected/);
    expect(await db.datasets.get(identity.datasetId)).toBeDefined();
  });

  it('refuses to delete the list of a job that stopped early and can still continue', async () => {
    const identity = await startPaginated();
    await commit(identity, 1, ['One']);
    await coordinator.handleTabClosed(TAB);
    expect((await db.jobs.get(identity.jobId))?.status).toBe('RECOVERABLE');

    await expect(datasets.deleteDataset(identity.datasetId)).rejects.toThrow(/stopped early/);
    expect(await titles(identity.datasetId)).toEqual(['One']);

    // Once the user stops it keeping the rows, the list is theirs to delete.
    expect((await coordinator.discardJob(identity.jobId)).ok).toBe(true);
    await datasets.deleteDataset(identity.datasetId);
    expect(await db.datasets.get(identity.datasetId)).toBeUndefined();
    expect(await db.records.where('datasetId').equals(identity.datasetId).count()).toBe(0);
  });

  it('deletes the list of a finished job with all its rows', async () => {
    const identity = await startPaginated();
    await commit(identity, 1, ['One']);
    expect((await coordinator.finishJob(identity.jobId)).ok).toBe(true);

    await datasets.deleteDataset(identity.datasetId);
    expect(await db.datasets.get(identity.datasetId)).toBeUndefined();
    expect(await db.records.count()).toBe(0);
  });

  it('refuses a grid edit while the job runs, so rows committed after the grid read the list survive', async () => {
    const identity = await startPaginated();
    await commit(identity, 1, ['One', 'Two']);

    // The grid reads the list, then the page commits another page before the edit is saved.
    const shown = await db.getDatasetRecords(identity.datasetId);
    const dataset = await db.datasets.get(identity.datasetId);
    await commit(identity, 2, ['Three', 'Four']);

    const edited = shown.map((row) => ({ ...row, Title: String(row.Title).toUpperCase() }));
    await expect(datasets.applyEdit(identity.datasetId, edited, dataset!.fields)).rejects.toThrow(/still being collected/);

    expect(await titles(identity.datasetId)).toEqual(['One', 'Two', 'Three', 'Four']);
    expect((await db.datasets.get(identity.datasetId))?.recordsCount).toBe(4);
    expect((await db.jobs.get(identity.jobId))?.totalExtracted).toBe(4);
  });

  it('saves a grid edit once the job has finished', async () => {
    const identity = await startPaginated();
    await commit(identity, 1, ['One', 'Two']);
    await coordinator.finishJob(identity.jobId);

    const shown = await db.getDatasetRecords(identity.datasetId);
    const dataset = await db.datasets.get(identity.datasetId);
    await datasets.applyEdit(identity.datasetId, shown.slice(1), dataset!.fields);

    expect(await titles(identity.datasetId)).toEqual(['Two']);
    expect((await db.datasets.get(identity.datasetId))?.recordsCount).toBe(1);
  });

  it('saves a grid edit on a list with no job at all (imported or legacy data)', async () => {
    await db.datasets.add({
      id: 'loose',
      name: 'Loose',
      url: 'http://localhost:3000/',
      recordsCount: 0,
      fields: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await datasets.applyEdit('loose', [{ _id: 'r1', _page: 1, _extractedAt: 1, Title: 'x' }], []);
    expect((await db.datasets.get('loose'))?.recordsCount).toBe(1);
    await datasets.deleteDataset('loose');
    expect(await db.datasets.get('loose')).toBeUndefined();
  });
});
