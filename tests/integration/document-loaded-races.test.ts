import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobCoordinator, JobTransport } from '@/background/job-coordinator';
import { ExtensionMessage } from '@/contracts/messages';
import { JobIdentity } from '@/shared/contracts/job';
import { PageHarvestDB } from '@/storage/db';
import { JobRepository } from '@/storage/repositories';
import { BASE_URL, makeRecipe, uniqueDb } from '../utils/job-harness';

/**
 * A new document loads in a job's tab (handleContentReady) at the same moment the user
 * stops or pauses the job. The coordinator reads the job, decides, then writes the
 * checkpoint and hands the job to the page. A command that commits in between must win:
 * a stopped job gets no resumable checkpoint back and is not restarted in the page, and a
 * paused job is not restarted running.
 *
 * The interleaving is forced with a barrier on the checkpoint read, so it happens on every
 * run instead of by chance.
 */
describe('A document loading while the job is stopped or paused', () => {
  const TAB = 11;
  let db: PageHarvestDB;
  let coordinator: JobCoordinator;
  let sent: ExtensionMessage[];

  /** The generation of the run in the tab's current document, if it has one. */
  let pageRun: string | undefined;

  const transport: JobTransport = {
    sendToTab: async (_tabId, message) => {
      sent.push(message);
      if (message.type === 'EXTRACT_RECORDS') {
        pageRun = message.payload.identity.generation;
        return { accepted: true };
      }
      if (message.type === 'CONTROL_JOB') {
        // Like the content script: only a run of that generation applies a control.
        return pageRun === message.payload.identity.generation
          ? { accepted: true }
          : { accepted: false, reason: 'no_active_run' };
      }
      return { active: false };
    },
    broadcast: async () => undefined,
    openBlankTab: async () => 900,
    navigateTab: async () => undefined,
    getTabLoadStatus: async () => 'complete',
    injectContentScript: async () => ({ injected: false, url: BASE_URL }),
  };

  beforeEach(() => {
    sent = [];
    pageRun = undefined;
    db = uniqueDb();
    coordinator = new JobCoordinator({
      db,
      transport,
      checkPermissions: async () => ({ allGranted: true, missing: [] }),
      reporter: { report: (category, error) => ({ id: 'e', category, severity: 'ERROR', message: String(error), timestamp: 0 }) },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    db.close();
    await db.delete();
  });

  async function startBetweenPages(): Promise<JobIdentity> {
    const result = await coordinator.startJob({
      recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 10 }),
      tabId: TAB,
      sourceUrl: `${BASE_URL}/list`,
    });
    if (!result.ok || !result.identity) throw new Error(String(result.error));
    // The page clicked Next: the checkpoint says the job is between documents.
    const ack = await coordinator.commitCheckpoint(
      {
        identity: result.identity,
        navigation: {
          nextPage: 2,
          scrollsCompleted: 0,
          awaitingNavigation: true,
          expectedUrl: `${BASE_URL}/list?page=2`,
          visitedUrls: [],
          url: `${BASE_URL}/list`,
        },
      },
      { tabId: TAB }
    );
    expect(ack.status).toBe('committed');
    // The tab is now loading the next document, which has no run yet.
    pageRun = undefined;
    sent = [];
    return result.identity;
  }

  /** Holds handleContentReady right after it has read the checkpoint, until released. */
  function holdAfterCheckpointRead() {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const holding = new Promise<void>((resolve) => (reached = resolve));
    const original = JobRepository.prototype.getCheckpoint;
    let first = true;
    vi.spyOn(JobRepository.prototype, 'getCheckpoint').mockImplementation(async function (this: JobRepository, jobId: string) {
      const checkpoint = await original.call(this, jobId);
      if (first) {
        first = false;
        reached();
        await released;
      }
      return checkpoint;
    });
    return { holding, release };
  }

  const extractsFor = (jobId: string) =>
    sent.filter((m): m is Extract<ExtensionMessage, { type: 'EXTRACT_RECORDS' }> => m.type === 'EXTRACT_RECORDS' && m.payload.identity.jobId === jobId);

  it.each([
    ['cancelled', (c: JobCoordinator, id: string) => c.cancelJob(id), 'CANCELLED'],
    ['finished', (c: JobCoordinator, id: string) => c.finishJob(id), 'COMPLETED'],
  ] as const)('leaves a job %s mid-load ended: no checkpoint comes back and the page is not restarted', async (_name, end, status) => {
    const identity = await startBetweenPages();
    const gate = holdAfterCheckpointRead();

    const loading = coordinator.handleContentReady(`${BASE_URL}/list?page=2`, TAB);
    await gate.holding;
    expect((await end(coordinator, identity.jobId)).ok).toBe(true);
    gate.release();
    await loading;

    const job = await db.jobs.get(identity.jobId);
    expect(job?.status).toBe(status);
    // The contract: a checkpoint exists only while a job can still continue.
    expect(await db.checkpoints.get(identity.jobId)).toBeUndefined();
    expect(extractsFor(identity.jobId)).toEqual([]);
  });

  it('keeps a job paused mid-load parked on the new page instead of restarting it', async () => {
    const identity = await startBetweenPages();
    const gate = holdAfterCheckpointRead();

    const loading = coordinator.handleContentReady(`${BASE_URL}/list?page=2`, TAB);
    await gate.holding;
    expect((await coordinator.pauseJob(identity.jobId)).ok).toBe(true);
    gate.release();
    await loading;

    expect((await db.jobs.get(identity.jobId))?.status).toBe('PAUSED');
    // Nothing runs in the page while the panel says Paused.
    expect(extractsFor(identity.jobId)).toEqual([]);
    const checkpoint = await db.checkpoints.get(identity.jobId);
    expect(checkpoint?.currentUrl).toBe(`${BASE_URL}/list?page=2`);
    expect(checkpoint?.awaitingNavigation).toBe(true);

    // Resume starts the new page from where the job is parked.
    sent = [];
    expect((await coordinator.resumeJob(identity.jobId)).ok).toBe(true);
    const resumed = extractsFor(identity.jobId);
    expect(resumed).toHaveLength(1);
    expect(resumed[0].payload.resume.page).toBe(2);
  });

  it('pauses the new run when the pause commits while the page is being handed the job', async () => {
    const identity = await startBetweenPages();
    // Hold the hand-over itself: the checkpoint is written, the page has not got the run yet.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const holding = new Promise<void>((resolve) => (reached = resolve));
    const send = transport.sendToTab;
    vi.spyOn(transport, 'sendToTab').mockImplementation(async (tabId, message) => {
      if (message.type === 'EXTRACT_RECORDS') {
        reached();
        await released;
      }
      return send(tabId, message);
    });

    const loading = coordinator.handleContentReady(`${BASE_URL}/list?page=2`, TAB);
    await holding;
    // The panel's pause reaches a page with no run yet, which ignores it.
    expect((await coordinator.pauseJob(identity.jobId)).ok).toBe(true);
    release();
    await loading;

    const controls = sent.filter((m): m is Extract<ExtensionMessage, { type: 'CONTROL_JOB' }> => m.type === 'CONTROL_JOB');
    const extractAt = sent.findIndex((m) => m.type === 'EXTRACT_RECORDS');
    const pausesAfterRun = controls.filter((m) => sent.indexOf(m) > extractAt && m.payload.action === 'pause');
    // The run that started is told to pause, under its own generation.
    expect(pausesAfterRun.map((m) => m.payload.identity.generation)).toEqual([identity.generation]);
    expect((await db.jobs.get(identity.jobId))?.status).toBe('PAUSED');
  });

  it('aborts the new run when the job is stopped while the page is being handed it', async () => {
    const identity = await startBetweenPages();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const holding = new Promise<void>((resolve) => (reached = resolve));
    const send = transport.sendToTab;
    vi.spyOn(transport, 'sendToTab').mockImplementation(async (tabId, message) => {
      if (message.type === 'EXTRACT_RECORDS') {
        reached();
        await released;
      }
      return send(tabId, message);
    });

    const loading = coordinator.handleContentReady(`${BASE_URL}/list?page=2`, TAB);
    await holding;
    expect((await coordinator.cancelJob(identity.jobId)).ok).toBe(true);
    release();
    await loading;

    const extractAt = sent.findIndex((m) => m.type === 'EXTRACT_RECORDS');
    const abortsAfterRun = sent.filter(
      (m, index): m is Extract<ExtensionMessage, { type: 'CONTROL_JOB' }> =>
        index > extractAt && m.type === 'CONTROL_JOB' && m.payload.action === 'abort'
    );
    expect(abortsAfterRun.map((m) => m.payload.identity.generation)).toEqual([identity.generation]);
    expect(await db.checkpoints.get(identity.jobId)).toBeUndefined();
  });

  it('keeps a job saved for recovery when its tab closes mid-load, and does not restart it there', async () => {
    const identity = await startBetweenPages();
    const gate = holdAfterCheckpointRead();

    const loading = coordinator.handleContentReady(`${BASE_URL}/list?page=2`, TAB);
    await gate.holding;
    await coordinator.handleTabClosed(TAB);
    gate.release();
    await loading;

    const job = await db.jobs.get(identity.jobId);
    expect(job?.status).toBe('RECOVERABLE');
    expect(extractsFor(identity.jobId)).toEqual([]);
    // The saved session still points at the page the job was waiting for.
    const checkpoint = await db.checkpoints.get(identity.jobId);
    expect(checkpoint?.awaitingNavigation).toBe(true);
    expect(checkpoint?.expectedUrl).toBe(`${BASE_URL}/list?page=2`);
  });

  it('still continues the job on the new page when nothing else happened (control case)', async () => {
    const identity = await startBetweenPages();
    await coordinator.handleContentReady(`${BASE_URL}/list?page=2`, TAB);
    const started = extractsFor(identity.jobId);
    expect(started).toHaveLength(1);
    expect(started[0].payload.identity.generation).toBe(identity.generation);
    expect((await db.checkpoints.get(identity.jobId))?.awaitingNavigation).toBe(false);
  });
});
