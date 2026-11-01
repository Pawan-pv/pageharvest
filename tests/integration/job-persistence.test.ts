import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_URL,
  ExtensionHarness,
  makeBatch,
  makeRecipe,
  renderCards,
} from '../utils/job-harness';

const TAB = 101;

describe('Durable persistence owned by the background', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    harness.db.close();
    await harness.db.delete();
  });

  it('stores a single-page job with no side panel involved at all', async () => {
    renderCards(['Alpha', 'Beta', 'Gamma']);
    harness.loadPage(TAB, `${BASE_URL}/list`);

    const identity = await harness.start(TAB, makeRecipe());
    await harness.settled(TAB);

    expect(await harness.titles(identity.datasetId)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const job = await harness.job(identity.jobId);
    expect(job).toMatchObject({ status: 'COMPLETED', totalExtracted: 3, recordsDetected: 3 });
    expect((await harness.db.datasets.get(identity.datasetId))?.recordsCount).toBe(3);
  });

  it('attaches full identity and provenance to every stored row', async () => {
    renderCards(['Alpha']);
    harness.loadPage(TAB, `${BASE_URL}/list`);

    const identity = await harness.start(TAB, makeRecipe());
    await harness.settled(TAB);

    const [row] = await harness.rows(identity.datasetId);
    expect(row).toMatchObject({
      datasetId: identity.datasetId,
      _jobId: identity.jobId,
      _projectId: identity.projectId,
      _runId: identity.runId,
      _sourceUrl: `${BASE_URL}/list`,
      _page: 1,
    });
    expect(row._hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row._id).toBe(`${identity.jobId}:1:0`);
  });

  it('does not acknowledge a batch before its transaction has committed', async () => {
    const identity = await startPassiveJob(harness);

    let commitFinished = false;
    const originalTransaction = harness.db.transaction.bind(harness.db);
    const spy = vi.spyOn(harness.db, 'transaction').mockImplementation(((...args: unknown[]) => {
      const result = (originalTransaction as (...a: unknown[]) => Promise<unknown>)(...args);
      return result.then((value) => {
        commitFinished = true;
        return value;
      });
    }) as never);

    const ack = await harness.sendFromPage(TAB, makeBatch(identity, 1, ['Alpha']));
    spy.mockRestore();

    expect(ack.status).toBe('committed');
    expect(commitFinished).toBe(true);
    expect(await harness.titles(identity.datasetId)).toEqual(['Alpha']);
  });

  it('commits records, counters and checkpoint together, or none of them', async () => {
    const identity = await startPassiveJob(harness);

    const failure = vi
      .spyOn(harness.db.checkpoints, 'put')
      .mockRejectedValueOnce(new Error('disk full'));
    const ack = await harness.sendFromPage(TAB, makeBatch(identity, 1, ['Alpha']));
    failure.mockRestore();

    expect(ack).toMatchObject({ status: 'rejected', reason: 'persist_failed' });
    expect(await harness.rows(identity.datasetId)).toHaveLength(0);
    expect((await harness.job(identity.jobId))?.lastSequence).toBe(0);
    expect((await harness.job(identity.jobId))?.totalExtracted).toBe(0);
    expect((await harness.db.datasets.get(identity.datasetId))?.recordsCount).toBe(0);
  });

  it('accepts a retried batch after a failed commit, without duplicates', async () => {
    const identity = await startPassiveJob(harness);
    const batch = makeBatch(identity, 1, ['Alpha', 'Beta']);

    const failure = vi
      .spyOn(harness.db.checkpoints, 'put')
      .mockRejectedValueOnce(new Error('disk full'));
    expect((await harness.sendFromPage(TAB, batch)).status).toBe('rejected');
    failure.mockRestore();

    expect((await harness.sendFromPage(TAB, batch)).status).toBe('committed');
    expect(await harness.titles(identity.datasetId)).toEqual(['Alpha', 'Beta']);
  });

  it('keeps acknowledged records when the worker restarts between batches', async () => {
    const identity = await startPassiveJob(harness, { type: 'next_button' });

    expect((await harness.sendFromPage(TAB, makeBatch(identity, 1, ['A']))).status).toBe('committed');

    harness.restartServiceWorker();

    expect((await harness.sendFromPage(TAB, makeBatch(identity, 2, ['B']))).status).toBe('committed');
    expect(await harness.titles(identity.datasetId)).toEqual(['A', 'B']);
    expect((await harness.job(identity.jobId))?.lastSequence).toBe(2);
  });

  it('retries delivery while the worker is unavailable and loses nothing', async () => {
    renderCards(['Alpha', 'Beta']);
    const page = harness.loadPage(TAB, `${BASE_URL}/list`);
    harness.backgroundDown = false;

    const identity = await harness.start(TAB, makeRecipe());
    harness.backgroundDown = true;
    setTimeout(() => {
      harness.backgroundDown = false;
    }, 2);
    await page.coordinator.runSettled();
    harness.backgroundDown = false;

    expect(await harness.titles(identity.datasetId)).toEqual(['Alpha', 'Beta']);
    expect((await harness.job(identity.jobId))?.status).toBe('COMPLETED');
  });

  it('offers the job for recovery when delivery never succeeds', async () => {
    renderCards(['Alpha']);
    harness.loadPage(TAB, `${BASE_URL}/list`);
    const realCommit = harness.coordinator.commitBatch.bind(harness.coordinator);
    const commit = vi.spyOn(harness.coordinator, 'commitBatch').mockResolvedValue({
      status: 'rejected',
      sequence: 1,
      inserted: 0,
      duplicates: 0,
      reason: 'persist_failed',
    });

    const identity = await harness.start(TAB, makeRecipe());
    await harness.settled(TAB);
    commit.mockImplementation(realCommit);

    expect((await harness.job(identity.jobId))?.status).toBe('RECOVERABLE');
    expect(await harness.rows(identity.datasetId)).toHaveLength(0);
  });

  it('stops scrolling-page work after a rejected delivery instead of running on', async () => {
    const identity = await startPassiveJob(harness);
    await harness.coordinator.cancelJob(identity.jobId);

    const ack = await harness.sendFromPage(TAB, makeBatch(identity, 1, ['Late']));
    expect(ack).toMatchObject({ status: 'rejected', reason: 'job_not_active' });
  });

  it('creates and associates a project, dataset, schema and job', async () => {
    renderCards(['Alpha']);
    harness.loadPage(TAB, `${BASE_URL}/list`);
    const identity = await harness.start(TAB, makeRecipe());
    await harness.settled(TAB);

    const [job, dataset, project] = await Promise.all([
      harness.job(identity.jobId),
      harness.db.datasets.get(identity.datasetId),
      harness.db.projects.get(identity.projectId),
    ]);
    expect(project?.name).toBe('localhost');
    expect(dataset).toMatchObject({ projectId: identity.projectId, jobId: identity.jobId });
    expect(job?.schemaId).toBeDefined();
    expect(await harness.db.schemas.get(job?.schemaId as string)).toMatchObject({
      containerSelector: '.card',
      projectId: identity.projectId,
    });
  });

  it('reuses one project and one schema for repeated runs of the same configuration', async () => {
    renderCards(['Alpha']);
    harness.loadPage(TAB, `${BASE_URL}/list`);
    const first = await harness.start(TAB, makeRecipe());
    await harness.settled(TAB);
    const second = await harness.start(TAB, makeRecipe());
    await harness.settled(TAB);

    expect(second.projectId).toBe(first.projectId);
    expect(second.datasetId).not.toBe(first.datasetId);
    expect(await harness.db.projects.count()).toBe(1);
    expect(await harness.db.schemas.count()).toBe(1);
  });

  it('refuses a second job in a tab that already has one running', async () => {
    await startPassiveJob(harness);

    const result = await harness.coordinator.startJob({
      recipe: makeRecipe(),
      tabId: TAB,
      sourceUrl: `${BASE_URL}/list`,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already running/);
  });

  it('refuses browser internal pages and missing permissions before writing anything', async () => {
    const internal = await harness.coordinator.startJob({
      recipe: makeRecipe(),
      tabId: TAB,
      sourceUrl: 'https://chromewebstore.google.com/detail/x',
    });
    expect(internal.ok).toBe(false);

    const withoutPermission = new ExtensionHarness({
      checkPermissions: async () => ({ allGranted: false, missing: ['downloads'] }),
    });
    const denied = await withoutPermission.coordinator.startJob({
      recipe: makeRecipe(),
      tabId: TAB,
      sourceUrl: `${BASE_URL}/list`,
    });
    expect(denied.error).toMatch(/downloads/);

    expect(await harness.db.jobs.count()).toBe(0);
    expect(await withoutPermission.db.jobs.count()).toBe(0);
    await withoutPermission.db.delete();
  });

  it('marks the job failed and records it when the page cannot start', async () => {
    harness.tabsWithoutContent.add(TAB);
    const result = await harness.coordinator.startJob({
      recipe: makeRecipe(),
      tabId: TAB,
      sourceUrl: `${BASE_URL}/list`,
    });

    expect(result.ok).toBe(false);
    const [job] = await harness.db.jobs.toArray();
    expect(job.status).toBe('FAILED');
    expect((await harness.db.history.toArray())[0]).toMatchObject({ status: 'FAILED', jobId: job.id });
    expect(await harness.db.checkpoints.count()).toBe(0);
  });
});

/** Starts a job whose page accepts the command but does not run, so tests drive the batches. */
async function startPassiveJob(
  harness: ExtensionHarness,
  pagination: Parameters<typeof makeRecipe>[0] = { type: 'next_button' }
) {
  const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
  vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
  return harness.start(TAB, makeRecipe(pagination));
}
