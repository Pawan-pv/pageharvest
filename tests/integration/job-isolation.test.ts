import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobIdentity } from '@/shared/contracts/job';
import {
  BASE_URL,
  ExtensionHarness,
  makeBatch,
  makeRecipe,
} from '../utils/job-harness';

const TAB_A = 201;
const TAB_B = 202;

async function startPassive(
  harness: ExtensionHarness,
  tabId: number,
  url: string = `${BASE_URL}/list`,
  extra: { projectId?: string } = {}
): Promise<JobIdentity> {
  const { coordinator } = harness.loadPage(tabId, url);
  vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
  return harness.start(tabId, makeRecipe({ type: 'next_button' }), url, extra);
}

describe('Job identity and isolation', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(async () => {
    harness.db.close();
    await harness.db.delete();
  });

  it('rejects delayed messages from a cancelled job, and the next job holds only its own rows', async () => {
    const jobA = await startPassive(harness, TAB_A);
    await harness.sendFromPage(TAB_A, makeBatch(jobA, 1, ['A1']));
    await harness.coordinator.cancelJob(jobA.jobId);

    const jobB = await startPassive(harness, TAB_A);
    await harness.sendFromPage(TAB_A, makeBatch(jobB, 1, ['B1']));

    const late = await harness.sendFromPage(TAB_A, makeBatch(jobA, 2, ['A2-late']));

    expect(late).toMatchObject({ status: 'rejected', reason: 'job_not_active' });
    expect(await harness.titles(jobB.datasetId)).toEqual(['B1']);
    expect(await harness.titles(jobA.datasetId)).toEqual(['A1']);
    expect(jobB.jobId).not.toBe(jobA.jobId);
    expect(jobB.datasetId).not.toBe(jobA.datasetId);
    expect(jobB.runId).not.toBe(jobA.runId);
    expect(jobB.generation).not.toBe(jobA.generation);
  });

  it('preserves committed rows and removes the checkpoint when a job is cancelled', async () => {
    const job = await startPassive(harness, TAB_A);
    await harness.sendFromPage(TAB_A, makeBatch(job, 1, ['Kept']));

    const result = await harness.coordinator.cancelJob(job.jobId);

    expect(result.ok).toBe(true);
    expect(await harness.titles(job.datasetId)).toEqual(['Kept']);
    expect((await harness.job(job.jobId))?.status).toBe('CANCELLED');
    expect(await harness.checkpoint(job.jobId)).toBeUndefined();
    expect((await harness.db.history.where('jobId').equals(job.jobId).first())?.status).toBe('CANCELLED');
  });

  it('tells the page to abort, naming the generation it was running as', async () => {
    const job = await startPassive(harness, TAB_A);
    const send = vi.spyOn(harness.transport, 'sendToTab');

    await harness.coordinator.cancelJob(job.jobId);

    const control = send.mock.calls.map(([, message]) => message).find((m) => m.type === 'CONTROL_JOB');
    expect(control).toMatchObject({
      payload: { action: 'abort', identity: { generation: job.generation } },
    });
  });

  it('rejects a batch with a stale generation after the job was resumed', async () => {
    const job = await startPassive(harness, TAB_A);
    await harness.coordinator.interruptJob(job.jobId, 'Tab closed');
    harness.tabsWithoutContent.delete(TAB_A);

    await harness.coordinator.recoverJob(job.jobId);

    const stale = await harness.sendFromPage(TAB_A, makeBatch(job, 1, ['Old page']));
    // The stale page is also in the wrong tab now, and neither check may pass it.
    expect(stale.status).toBe('rejected');
    expect(await harness.rows(job.datasetId)).toHaveLength(0);
  });

  it('rejects a batch whose identity does not match the job', async () => {
    const job = await startPassive(harness, TAB_A);

    for (const forged of [
      { ...job, datasetId: 'dataset_other' },
      { ...job, projectId: 'project_other' },
      { ...job, runId: 'run_other' },
    ]) {
      const ack = await harness.sendFromPage(TAB_A, makeBatch(forged, 1, ['Forged']));
      expect(ack).toMatchObject({ status: 'rejected', reason: 'identity_mismatch' });
    }
    const wrongGeneration = await harness.sendFromPage(
      TAB_A,
      makeBatch({ ...job, generation: 'gen_other' }, 1, ['Forged'])
    );
    expect(wrongGeneration).toMatchObject({ status: 'rejected', reason: 'stale_generation' });

    expect(await harness.db.records.count()).toBe(0);
  });

  it('rejects a job that does not exist', async () => {
    const job = await startPassive(harness, TAB_A);
    const ack = await harness.sendFromPage(TAB_A, makeBatch({ ...job, jobId: 'job_unknown' }, 1, ['X']));
    expect(ack).toMatchObject({ status: 'rejected', reason: 'unknown_job' });
  });

  it('rejects a batch sent from a different tab than the job runs in', async () => {
    const job = await startPassive(harness, TAB_A);
    const ack = await harness.sendFromPage(TAB_B, makeBatch(job, 1, ['Wrong tab']));
    expect(ack).toMatchObject({ status: 'rejected', reason: 'wrong_tab' });
    expect(await harness.rows(job.datasetId)).toHaveLength(0);
  });

  it('applies a redelivered batch once and acknowledges it as already durable', async () => {
    const job = await startPassive(harness, TAB_A);
    const batch = makeBatch(job, 1, ['Once']);

    expect((await harness.sendFromPage(TAB_A, batch)).status).toBe('committed');
    expect((await harness.sendFromPage(TAB_A, batch)).status).toBe('duplicate');

    expect(await harness.titles(job.datasetId)).toEqual(['Once']);
    expect((await harness.job(job.jobId))?.totalExtracted).toBe(1);
  });

  it('rejects a batch that skips ahead, then accepts them in order', async () => {
    const job = await startPassive(harness, TAB_A);

    const ahead = await harness.sendFromPage(TAB_A, makeBatch(job, 3, ['Third']));
    expect(ahead).toMatchObject({ status: 'rejected', reason: 'out_of_order' });
    expect(await harness.rows(job.datasetId)).toHaveLength(0);

    await harness.sendFromPage(TAB_A, makeBatch(job, 1, ['First']));
    await harness.sendFromPage(TAB_A, makeBatch(job, 2, ['Second']));
    expect((await harness.sendFromPage(TAB_A, makeBatch(job, 3, ['Third']))).status).toBe('committed');

    expect(await harness.titles(job.datasetId)).toEqual(['First', 'Second', 'Third']);
  });

  it('ignores a duplicate progress broadcast source: counters come only from commits', async () => {
    const job = await startPassive(harness, TAB_A);
    const batch = makeBatch(job, 1, ['A', 'B']);

    await harness.sendFromPage(TAB_A, batch);
    await harness.sendFromPage(TAB_A, batch);
    await harness.sendFromPage(TAB_A, batch);

    expect((await harness.job(job.jobId))?.totalExtracted).toBe(2);
    expect((await harness.job(job.jobId))?.recordsDetected).toBe(2);
  });

  it('ignores a late completion from a cancelled job', async () => {
    const job = await startPassive(harness, TAB_A);
    await harness.coordinator.cancelJob(job.jobId);

    const ack = await harness.sendFromPage(TAB_A, {
      id: 'done',
      type: 'JOB_FINISHED',
      timestamp: 1,
      payload: { identity: job, lastSequence: 0, stopReason: 'completed' },
    });

    expect(ack.status).toBe('rejected');
    expect((await harness.job(job.jobId))?.status).toBe('CANCELLED');
    expect(await harness.db.history.where('jobId').equals(job.jobId).count()).toBe(1);
  });

  it('ignores a late error from a finished job', async () => {
    const job = await startPassive(harness, TAB_A);
    await harness.coordinator.finishJob(job.jobId);

    const ack = await harness.sendFromPage(TAB_A, {
      id: 'err',
      type: 'JOB_FAILED',
      timestamp: 1,
      payload: { identity: job, message: 'Too late', category: 'DOM_PARSING', recoverable: false },
    });

    expect(ack.status).toBe('rejected');
    const stored = await harness.job(job.jobId);
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.errorMessage).toBeUndefined();
  });

  it('refuses a completion that overtakes a batch not yet stored', async () => {
    const job = await startPassive(harness, TAB_A);

    const ack = await harness.sendFromPage(TAB_A, {
      id: 'done',
      type: 'JOB_FINISHED',
      timestamp: 1,
      payload: { identity: job, lastSequence: 5, stopReason: 'completed' },
    });

    expect(ack.status).toBe('rejected');
    expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
  });

  it('keeps two tabs extracting at once completely separate', async () => {
    const jobA = await startPassive(harness, TAB_A);
    const jobB = await startPassive(harness, TAB_B);

    await Promise.all([
      harness.sendFromPage(TAB_A, makeBatch(jobA, 1, ['A1'])),
      harness.sendFromPage(TAB_B, makeBatch(jobB, 1, ['B1'])),
    ]);
    await Promise.all([
      harness.sendFromPage(TAB_B, makeBatch(jobB, 2, ['B2'])),
      harness.sendFromPage(TAB_A, makeBatch(jobA, 2, ['A2'])),
    ]);

    expect(await harness.titles(jobA.datasetId)).toEqual(['A1', 'A2']);
    expect(await harness.titles(jobB.datasetId)).toEqual(['B1', 'B2']);
  });

  it('keeps two projects extracting independently', async () => {
    const jobA = await startPassive(harness, TAB_A, 'https://one.example.com/list');
    const jobB = await startPassive(harness, TAB_B, 'https://two.example.com/list');

    expect(jobA.projectId).not.toBe(jobB.projectId);

    await harness.sendFromPage(TAB_A, makeBatch(jobA, 1, ['One']));
    await harness.sendFromPage(TAB_B, makeBatch(jobB, 1, ['Two']));
    await harness.coordinator.cancelJob(jobA.jobId);
    await harness.sendFromPage(TAB_B, makeBatch(jobB, 2, ['Two more']));

    expect((await harness.job(jobB.jobId))?.status).toBe('RUNNING');
    expect(await harness.db.records.where('_projectId').equals(jobA.projectId).count()).toBe(1);
    expect(await harness.db.records.where('_projectId').equals(jobB.projectId).count()).toBe(2);
  });

  it('is safe when cancellation and a batch race: the row is durable only if acknowledged', async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const tabId = 300 + attempt;
      const job = await startPassive(harness, tabId);

      const [ack] = await Promise.all([
        harness.sendFromPage(tabId, makeBatch(job, 1, [`Race ${attempt}`])),
        // Vary who reaches the database first.
        attempt % 2 === 0
          ? harness.coordinator.cancelJob(job.jobId)
          : Promise.resolve().then(() => harness.coordinator.cancelJob(job.jobId)),
      ]);

      const rows = await harness.rows(job.datasetId);
      expect((await harness.job(job.jobId))?.status).toBe('CANCELLED');
      if (ack.status === 'committed') {
        expect(rows).toHaveLength(1);
      } else {
        expect(ack.status).toBe('rejected');
        expect(rows).toHaveLength(0);
      }
    }
  });

  it('accepts a batch already in flight when the user pauses', async () => {
    const job = await startPassive(harness, TAB_A);
    await harness.coordinator.pauseJob(job.jobId);

    expect((await harness.sendFromPage(TAB_A, makeBatch(job, 1, ['In flight']))).status).toBe('committed');
    expect((await harness.job(job.jobId))?.status).toBe('PAUSED');
  });

  it('refuses commands that do not fit the current state, leaving the job unchanged', async () => {
    const job = await startPassive(harness, TAB_A);

    expect((await harness.coordinator.resumeJob(job.jobId)).ok).toBe(false);
    expect((await harness.coordinator.recoverJob(job.jobId)).ok).toBe(false);
    expect((await harness.job(job.jobId))?.status).toBe('RUNNING');

    await harness.coordinator.cancelJob(job.jobId);
    expect((await harness.coordinator.pauseJob(job.jobId)).ok).toBe(false);
    expect((await harness.coordinator.cancelJob(job.jobId)).ok).toBe(false);
    expect((await harness.coordinator.finishJob(job.jobId)).ok).toBe(false);
    expect(await harness.db.history.where('jobId').equals(job.jobId).count()).toBe(1);
  });
});
