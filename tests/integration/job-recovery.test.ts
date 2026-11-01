import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL, ExtensionHarness, makeBatch, makeRecipe, renderCards } from '../utils/job-harness';

const TAB = 401;
const DAY_MS = 24 * 60 * 60 * 1000;

async function startPassive(harness: ExtensionHarness, tabId: number = TAB) {
  const { coordinator } = harness.loadPage(tabId, `${BASE_URL}/list`);
  vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
  return harness.start(tabId, makeRecipe({ type: 'next_button', maxPages: 10 }));
}

describe('Session recovery lifecycle', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(async () => {
    harness.db.close();
    await harness.db.delete();
  });

  describe('detecting an interruption', () => {
    it('marks a job recoverable when its tab closes, keeping records and checkpoint', async () => {
      const job = await startPassive(harness);
      await harness.sendFromPage(TAB, makeBatch(job, 1, ['Saved']));

      await harness.coordinator.handleTabClosed(TAB);

      const stored = await harness.job(job.jobId);
      expect(stored?.status).toBe('RECOVERABLE');
      expect(stored?.interruptedReason).toMatch(/closed/);
      expect(await harness.checkpoint(job.jobId)).toBeDefined();
      expect(await harness.titles(job.datasetId)).toEqual(['Saved']);
    });

    it('does not record a history entry until the session is resolved', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.handleTabClosed(TAB);

      expect(await harness.db.history.where('jobId').equals(job.jobId).count()).toBe(0);
    });

    it('ignores a closed tab that has no job', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.handleTabClosed(TAB + 99);
      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });

    it('interrupts running and paused jobs when the browser restarts', async () => {
      const running = await startPassive(harness, TAB);
      const paused = await startPassive(harness, TAB + 1);
      await harness.coordinator.pauseJob(paused.jobId);

      await harness.coordinator.reconcile('startup');

      expect((await harness.job(running.jobId))?.status).toBe('RECOVERABLE');
      expect((await harness.job(paused.jobId))?.status).toBe('RECOVERABLE');
    });

    it('interrupts running jobs when the extension is reloaded', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.reconcile('installed');
      expect((await harness.job(job.jobId))?.interruptedReason).toMatch(/reloaded or updated/);
    });

    it('leaves a running job alone when only the service worker restarts', async () => {
      const job = await startPassive(harness);

      harness.restartServiceWorker();
      await harness.coordinator.reconcile('wake');

      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });

    it('does not create a recovery entry for a job with nothing wrong', async () => {
      renderCards(['Alpha']);
      harness.loadPage(TAB, `${BASE_URL}/list`);
      await harness.start(TAB, makeRecipe());
      await harness.settled(TAB);

      await harness.coordinator.reconcile('startup');

      expect(await harness.db.jobs.where('status').equals('RECOVERABLE').count()).toBe(0);
    });

    it('fails rather than offers recovery when the checkpoint is missing', async () => {
      const job = await startPassive(harness);
      await harness.db.checkpoints.delete(job.jobId);

      await harness.coordinator.handleTabClosed(TAB);

      expect((await harness.job(job.jobId))?.status).toBe('FAILED');
      expect(await harness.db.jobs.where('status').equals('RECOVERABLE').count()).toBe(0);
    });

    describe('when the panel asks for reconciliation', () => {
      const backdate = async (jobId: string) => {
        await harness.db.jobs.update(jobId, { updatedAt: Date.now() - 60_000 });
      };

      it('interrupts a running job whose page no longer has it', async () => {
        const job = await startPassive(harness);
        await backdate(job.jobId);
        harness.unloadPage(TAB);

        await harness.coordinator.reconcile('panel');

        expect((await harness.job(job.jobId))?.status).toBe('RECOVERABLE');
      });

      it('leaves a job alone while its page reports it is running', async () => {
        const job = await startPassive(harness);
        await backdate(job.jobId);
        const page = harness.loadPage(TAB, `${BASE_URL}/list`);
        vi.spyOn(page.coordinator, 'queryJobRun').mockReturnValue({
          active: true,
          jobId: job.jobId,
          generation: job.generation,
        });

        await harness.coordinator.reconcile('panel');

        expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
      });

      it('does not probe a job that has only just started', async () => {
        const job = await startPassive(harness);
        harness.unloadPage(TAB);

        await harness.coordinator.reconcile('panel');

        expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
      });

      it('does not interrupt a job while its start is still reaching the page', async () => {
        renderCards(['One', 'Two']);
        harness.loadPage(TAB, `${BASE_URL}/list`);
        const sendToTab = harness.transport.sendToTab;
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        harness.transport.sendToTab = async (tabId, message) => {
          if ((message as { type?: string }).type === 'EXTRACT_RECORDS') await held;
          return sendToTab(tabId, message);
        };

        const starting = harness.start(TAB, makeRecipe(), `${BASE_URL}/list`);
        await vi.waitFor(async () => expect(await harness.db.jobs.count()).toBe(1));
        const [stalled] = await harness.db.jobs.toArray();
        // A slow database makes a job look quiet before its page has heard about it.
        await backdate(stalled.id);

        await harness.coordinator.reconcile('panel');
        expect((await harness.job(stalled.id))?.status).toBe('RUNNING');

        release();
        await starting;
        await harness.settled(TAB);
        expect((await harness.job(stalled.id))?.status).toBe('COMPLETED');
        expect(await harness.titles(stalled.datasetId as string)).toEqual(['One', 'Two']);
      });

      it('does not interrupt a job that moved on while the page was being asked', async () => {
        const job = await startPassive(harness);
        await backdate(job.jobId);
        const sendToTab = harness.transport.sendToTab;
        harness.transport.sendToTab = async (tabId, message) => {
          if ((message as { type?: string }).type === 'QUERY_JOB_RUN') {
            // The page answers for the document it had, while a new one reports ready.
            await harness.db.jobs.update(job.jobId, { updatedAt: Date.now() });
            return { active: false };
          }
          return sendToTab(tabId, message);
        };

        await harness.coordinator.reconcile('panel');

        expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
      });

      it('allows a page navigation time to finish before calling it interrupted', async () => {
        const job = await startPassive(harness);
        await backdate(job.jobId);
        await harness.db.checkpoints.update(job.jobId, {
          awaitingNavigation: true,
          navigationStartedAt: Date.now(),
        });
        harness.unloadPage(TAB);

        await harness.coordinator.reconcile('panel');
        expect((await harness.job(job.jobId))?.status).toBe('RUNNING');

        await harness.db.checkpoints.update(job.jobId, { navigationStartedAt: Date.now() - 120_000 });
        await harness.coordinator.reconcile('panel');
        expect((await harness.job(job.jobId))?.status).toBe('RECOVERABLE');
      });
    });
  });

  describe('resuming', () => {
    it('continues the same job and dataset from where it stopped, in a new tab', async () => {
      const job = await startPassive(harness);
      await harness.sendFromPage(TAB, makeBatch(job, 1, ['Page 1']));
      await harness.coordinator.handleTabClosed(TAB);

      const result = await harness.coordinator.recoverJob(job.jobId);

      expect(result.ok).toBe(true);
      expect(result.identity?.jobId).toBe(job.jobId);
      expect(result.identity?.datasetId).toBe(job.datasetId);
      expect(result.identity?.generation).not.toBe(job.generation);
      expect(await harness.db.jobs.count()).toBe(1);

      const stored = await harness.job(job.jobId);
      expect(stored).toMatchObject({ status: 'RUNNING', lastSequence: 1 });
      expect(stored?.tabId).not.toBe(TAB);
      expect(harness.navigations.at(-1)).toEqual({ tabId: stored?.tabId, url: `${BASE_URL}/page-1` });
    });

    it('restarts extraction when the reopened page reports in, without duplicates', async () => {
      const job = await startPassive(harness);
      await harness.sendFromPage(TAB, makeBatch(job, 1, ['Alpha', 'Beta']));
      await harness.coordinator.handleTabClosed(TAB);
      await harness.coordinator.recoverJob(job.jobId);
      const tabId = (await harness.job(job.jobId))?.tabId as number;

      // The reopened page still shows the rows that were already saved, plus one more.
      renderCards(['Alpha', 'Beta', 'Gamma']);
      harness.loadPage(tabId, `${BASE_URL}/page-1`);
      await harness.announceReady(tabId);
      await harness.settled(tabId);

      expect(await harness.titles(job.datasetId)).toEqual(['Alpha', 'Beta', 'Gamma']);
      const stored = await harness.job(job.jobId);
      expect(stored?.totalExtracted).toBe(3);
      expect(stored?.duplicatesSkipped).toBe(2);
      expect(stored?.status).toBe('COMPLETED');
      expect(await harness.checkpoint(job.jobId)).toBeUndefined();
    });

    it('cannot be resumed twice', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.handleTabClosed(TAB);

      const [first, second] = await Promise.all([
        harness.coordinator.recoverJob(job.jobId),
        harness.coordinator.recoverJob(job.jobId),
      ]);

      expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
      expect(await harness.db.jobs.count()).toBe(1);
    });

    it('reports a session whose checkpoint has gone missing', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.handleTabClosed(TAB);
      await harness.db.checkpoints.delete(job.jobId);

      const result = await harness.coordinator.recoverJob(job.jobId);

      expect(result.ok).toBe(false);
      expect((await harness.job(job.jobId))?.status).toBe('FAILED');
    });

    it('refuses to reopen a checkpoint pointing at another website', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.handleTabClosed(TAB);
      await harness.db.checkpoints.update(job.jobId, { currentUrl: 'https://evil.example.com/' });

      const result = await harness.coordinator.recoverJob(job.jobId);

      expect(result.ok).toBe(false);
      expect(harness.navigations).toHaveLength(0);
    });

    it('stays recoverable when the page cannot be reopened', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.handleTabClosed(TAB);
      vi.spyOn(harness.transport, 'navigateTab').mockRejectedValueOnce(new Error('No such tab'));

      const result = await harness.coordinator.recoverJob(job.jobId);

      expect(result.ok).toBe(false);
      expect((await harness.job(job.jobId))?.status).toBe('RECOVERABLE');
    });
  });

  describe('discarding and expiring', () => {
    it('discard ends the session, keeps the rows and clears the checkpoint', async () => {
      const job = await startPassive(harness);
      await harness.sendFromPage(TAB, makeBatch(job, 1, ['Kept']));
      await harness.coordinator.handleTabClosed(TAB);

      const result = await harness.coordinator.discardJob(job.jobId);

      expect(result.ok).toBe(true);
      expect((await harness.job(job.jobId))?.status).toBe('CANCELLED');
      expect(await harness.checkpoint(job.jobId)).toBeUndefined();
      expect(await harness.titles(job.datasetId)).toEqual(['Kept']);
      expect(await harness.db.history.where('jobId').equals(job.jobId).count()).toBe(1);
    });

    it('expires a session abandoned past the retention period, keeping its rows', async () => {
      const job = await startPassive(harness);
      await harness.sendFromPage(TAB, makeBatch(job, 1, ['Kept']));
      await harness.coordinator.handleTabClosed(TAB);
      await harness.db.checkpoints.update(job.jobId, { expiresAt: Date.now() - DAY_MS });

      await harness.coordinator.reconcile('wake');

      expect((await harness.job(job.jobId))?.status).toBe('EXPIRED');
      expect(await harness.checkpoint(job.jobId)).toBeUndefined();
      expect(await harness.titles(job.datasetId)).toEqual(['Kept']);
      expect((await harness.db.history.where('jobId').equals(job.jobId).first())?.status).toBe('EXPIRED');
    });

    it('applies the retention period from settings', async () => {
      await harness.db.settings.put({
        ...(await import('@/types/settings')).DEFAULT_USER_SETTINGS,
        retentionDays: 2,
      });
      const before = Date.now();
      const job = await startPassive(harness);

      const checkpoint = await harness.checkpoint(job.jobId);
      expect(checkpoint?.expiresAt).toBeGreaterThanOrEqual(before + 2 * DAY_MS);
      expect(checkpoint?.expiresAt).toBeLessThan(before + 3 * DAY_MS);
    });

    it('refuses to resume an expired session', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.handleTabClosed(TAB);
      await harness.db.checkpoints.update(job.jobId, { expiresAt: Date.now() - 1 });

      const result = await harness.coordinator.recoverJob(job.jobId);

      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
      expect((await harness.job(job.jobId))?.status).toBe('EXPIRED');
    });
  });

  describe('terminal states clean up their checkpoint', () => {
    it.each([
      ['finish', (h: ExtensionHarness, id: string) => h.coordinator.finishJob(id), 'COMPLETED'],
      ['cancel', (h: ExtensionHarness, id: string) => h.coordinator.cancelJob(id), 'CANCELLED'],
    ])('after %s', async (_name, act, status) => {
      const job = await startPassive(harness);

      await act(harness, job.jobId);

      expect((await harness.job(job.jobId))?.status).toBe(status);
      expect(await harness.checkpoint(job.jobId)).toBeUndefined();
      expect(await harness.db.checkpoints.count()).toBe(0);
    });

    it('after a failure', async () => {
      const job = await startPassive(harness);

      await harness.sendFromPage(TAB, {
        id: 'failed',
        type: 'JOB_FAILED',
        timestamp: 1,
        payload: { identity: job, message: 'Bad selector', category: 'DOM_PARSING', recoverable: false },
      });

      expect(await harness.job(job.jobId)).toMatchObject({ status: 'FAILED', errorMessage: 'Bad selector' });
      expect(await harness.checkpoint(job.jobId)).toBeUndefined();
      expect((await harness.db.history.where('jobId').equals(job.jobId).first())?.errorMessage).toBe('Bad selector');
    });
  });

  describe('pause and resume', () => {
    it('holds the page at the pause gate and continues on resume', async () => {
      renderCards(['Alpha']);
      const page = harness.loadPage(TAB, `${BASE_URL}/list`);
      const job = await harness.start(TAB, makeRecipe());
      await harness.coordinator.pauseJob(job.jobId);
      expect(page.coordinator.queryJobRun().paused).toBe(true);

      await harness.coordinator.resumeJob(job.jobId);
      await harness.settled(TAB);

      expect((await harness.job(job.jobId))?.status).toBe('COMPLETED');
    });

    it('counts paused time out of the elapsed time', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.pauseJob(job.jobId);
      await harness.db.jobs.update(job.jobId, { pausedAt: Date.now() - 5000 });

      await harness.coordinator.resumeJob(job.jobId);

      const stored = await harness.job(job.jobId);
      expect(stored?.pausedMs).toBeGreaterThanOrEqual(5000);
      expect(stored?.pausedAt).toBeUndefined();
    });

    it('starts the current document again when the paused run is gone', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.pauseJob(job.jobId);
      const reloaded = harness.loadPage(TAB, `${BASE_URL}/list`);
      const extract = vi.spyOn(reloaded.coordinator, 'extractRecords').mockReturnValue({ accepted: true });

      await harness.coordinator.resumeJob(job.jobId);

      expect(extract).toHaveBeenCalledTimes(1);
      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });

    it('saves the job for recovery when resuming finds no page at all', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.pauseJob(job.jobId);
      harness.closeTab(TAB);

      const result = await harness.coordinator.resumeJob(job.jobId);

      expect(result.ok).toBe(false);
      expect((await harness.job(job.jobId))?.status).toBe('RECOVERABLE');
    });
  });

  describe('a page that fails to load', () => {
    it('interrupts the job once the tab has loaded and no content script arrived', async () => {
      const scheduled: Array<() => void> = [];
      harness = new ExtensionHarness({ schedule: (callback) => scheduled.push(callback) });
      const job = await startPassive(harness);
      await harness.db.checkpoints.update(job.jobId, {
        awaitingNavigation: true,
        expectedUrl: `${BASE_URL}/page-2`,
      });

      await harness.coordinator.handleTabLoaded(TAB);
      await harness.coordinator.checkPendingNavigation(job.jobId, TAB);

      expect(scheduled).toHaveLength(1);
      expect((await harness.job(job.jobId))?.interruptedReason).toMatch(/page-2 failed to load/);
    });

    it('keeps waiting while the tab is still loading', async () => {
      const job = await startPassive(harness);
      await harness.db.checkpoints.update(job.jobId, { awaitingNavigation: true });
      harness.tabLoadStatus.set(TAB, 'loading');

      await harness.coordinator.checkPendingNavigation(job.jobId, TAB);

      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });

    it('does nothing when the expected page arrived first', async () => {
      const job = await startPassive(harness);

      await harness.coordinator.checkPendingNavigation(job.jobId, TAB);

      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });
  });
});
