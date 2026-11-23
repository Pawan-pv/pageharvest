import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobCoordinator, JobTransport } from '@/background/job-coordinator';
import { PageHarvestDB } from '@/storage/db';
import { BASE_URL, makeRecipe, uniqueDb } from '../utils/job-harness';

/**
 * Resuming a stopped-early session opens a new tab for it. A double click on Continue sends
 * two requests; the session must resume once, in one tab, and leave no empty tab behind.
 */
describe('Continue pressed twice', () => {
  const TAB = 5;
  let db: PageHarvestDB;
  let coordinator: JobCoordinator;
  let opened: number[];
  let navigated: number[];
  let closed: number[];

  const transport: JobTransport = {
    sendToTab: async () => ({ accepted: true }),
    broadcast: async () => undefined,
    openBlankTab: async () => {
      const id = 300 + opened.length;
      opened.push(id);
      return id;
    },
    navigateTab: async (tabId) => {
      navigated.push(tabId);
    },
    closeTab: async (tabId) => {
      closed.push(tabId);
    },
    getTabLoadStatus: async () => 'complete',
    injectContentScript: async () => ({ injected: false, url: BASE_URL }),
  };

  beforeEach(() => {
    opened = [];
    navigated = [];
    closed = [];
    db = uniqueDb();
    coordinator = new JobCoordinator({
      db,
      transport,
      checkPermissions: async () => ({ allGranted: true, missing: [] }),
      reporter: { report: (category, error) => ({ id: 'e', category, severity: 'ERROR', message: String(error), timestamp: 0 }) },
    });
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  async function stoppedEarly(): Promise<string> {
    const result = await coordinator.startJob({
      recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 5 }),
      tabId: TAB,
      sourceUrl: `${BASE_URL}/list`,
    });
    if (!result.ok || !result.identity) throw new Error(String(result.error));
    await coordinator.handleTabClosed(TAB);
    return result.identity.jobId;
  }

  it('resumes once and opens exactly one tab when two requests arrive together', async () => {
    const jobId = await stoppedEarly();

    const results = await Promise.all([coordinator.recoverJob(jobId), coordinator.recoverJob(jobId)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(opened).toHaveLength(1);
    expect(navigated).toEqual(opened);
    const job = await db.jobs.get(jobId);
    expect(job?.status).toBe('RUNNING');
    expect(job?.tabId).toBe(opened[0]);
  });

  it('opens no tab for a session that was already resumed', async () => {
    const jobId = await stoppedEarly();
    expect((await coordinator.recoverJob(jobId)).ok).toBe(true);
    expect((await coordinator.recoverJob(jobId)).ok).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('can be resumed again after the first attempt could not open a tab', async () => {
    const jobId = await stoppedEarly();
    const open = transport.openBlankTab;
    transport.openBlankTab = async () => {
      throw new Error('No window');
    };
    expect((await coordinator.recoverJob(jobId)).ok).toBe(false);
    transport.openBlankTab = open;
    expect((await coordinator.recoverJob(jobId)).ok).toBe(true);
  });

  it('closes the tab it opened when navigation fails', async () => {
    const jobId = await stoppedEarly();
    const navigate = transport.navigateTab;
    transport.navigateTab = async () => {
      throw new Error('No such tab');
    };

    const result = await coordinator.recoverJob(jobId);

    expect(result.ok).toBe(false);
    expect(opened).toHaveLength(1);
    expect(closed).toEqual(opened);
    expect((await db.jobs.get(jobId))?.status).toBe('RECOVERABLE');
    transport.navigateTab = navigate;
  });

  it('closes the losing tab when two workers race to resume the same session', async () => {
    const jobId = await stoppedEarly();
    // Two service-worker instances have separate in-memory locks but share IndexedDB.
    const other = new JobCoordinator({
      db,
      transport,
      checkPermissions: async () => ({ allGranted: true, missing: [] }),
      reporter: { report: (category, error) => ({ id: 'e', category, severity: 'ERROR', message: String(error), timestamp: 0 }) },
    });

    const results = await Promise.all([coordinator.recoverJob(jobId), other.recoverJob(jobId)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(opened).toHaveLength(2);
    expect(closed).toHaveLength(1);
    expect(navigated).toEqual(opened.filter((id) => !closed.includes(id)));
    expect((await db.jobs.get(jobId))?.status).toBe('RUNNING');
  });
});
