import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobCoordinator, JobTransport } from '@/background/job-coordinator';
import { JobIdentity } from '@/shared/contracts/job';
import { PageHarvestDB } from '@/storage/db';
import { SettingsRepository } from '@/storage/repositories';
import { BASE_URL, makeRecipe, uniqueDb } from '../utils/job-harness';

/**
 * A job that stopped early is kept for `retentionDays` ("Interrupted sessions can be kept for
 * 1 to 365 days", Settings; ARCHITECTURE.md, Expiry). The period runs from when the session
 * was abandoned, not from when the job first started: a job interrupted late in a long run,
 * or interrupted again after a resume, still gets the whole period.
 */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('How long a stopped-early session is kept', () => {
  const TAB = 3;
  let db: PageHarvestDB;
  let coordinator: JobCoordinator;
  const clock = { now: 1_800_000_000_000 };

  const transport: JobTransport = {
    sendToTab: async () => ({ accepted: true }),
    broadcast: async () => undefined,
    openBlankTab: async () => 77,
    navigateTab: async () => undefined,
    getTabLoadStatus: async () => 'complete',
    injectContentScript: async () => ({ injected: false, url: BASE_URL }),
  };

  beforeEach(async () => {
    clock.now = 1_800_000_000_000;
    db = uniqueDb();
    coordinator = new JobCoordinator({
      db,
      transport,
      now: () => clock.now,
      checkPermissions: async () => ({ allGranted: true, missing: [] }),
      reporter: { report: (category, error) => ({ id: 'e', category, severity: 'ERROR', message: String(error), timestamp: 0 }) },
    });
    await new SettingsRepository(db).updateSettings({ retentionDays: 1 });
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  async function start(): Promise<JobIdentity> {
    const result = await coordinator.startJob({
      recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 50 }),
      tabId: TAB,
      sourceUrl: `${BASE_URL}/list`,
    });
    if (!result.ok || !result.identity) throw new Error(String(result.error));
    return result.identity;
  }

  const status = async (jobId: string) => (await db.jobs.get(jobId))?.status;

  it('counts the period from the interruption, not from the start of the job', async () => {
    const { jobId } = await start();

    clock.now += 20 * HOUR; // a long run
    await coordinator.handleTabClosed(TAB);
    expect(await status(jobId)).toBe('RECOVERABLE');

    clock.now += 5 * HOUR; // 25 h after the start, 5 h after it stopped
    await coordinator.reconcile('wake');
    expect(await status(jobId)).toBe('RECOVERABLE');

    clock.now += 20 * HOUR; // 25 h after it stopped
    await coordinator.reconcile('wake');
    expect(await status(jobId)).toBe('EXPIRED');
  });

  it('gives a session interrupted again after a resume the whole period again', async () => {
    const { jobId } = await start();
    await coordinator.handleTabClosed(TAB);

    clock.now += 23 * HOUR;
    expect((await coordinator.recoverJob(jobId)).ok).toBe(true);
    await coordinator.handleTabClosed(77);
    expect(await status(jobId)).toBe('RECOVERABLE');

    clock.now += 12 * HOUR;
    await coordinator.reconcile('wake');
    expect(await status(jobId)).toBe('RECOVERABLE');
    expect((await coordinator.recoverJob(jobId)).ok).toBe(true);
  });

  it('still expires a session nobody came back to', async () => {
    const { jobId } = await start();
    await coordinator.handleTabClosed(TAB);
    clock.now += DAY + 1;
    await coordinator.reconcile('wake');
    expect(await status(jobId)).toBe('EXPIRED');
    expect(await db.checkpoints.get(jobId)).toBeUndefined();
    expect((await coordinator.recoverJob(jobId)).ok).toBe(false);
  });
});
