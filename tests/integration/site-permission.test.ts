import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL, ExtensionHarness, makeBatch, makeRecipe } from '../utils/job-harness';
import { originPatternForUrl } from '@/platform/permissions';

const TAB = 601;

async function startPassive(harness: ExtensionHarness, tabId: number = TAB) {
  const { coordinator } = harness.loadPage(tabId, `${BASE_URL}/list`);
  vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
  return harness.start(tabId, makeRecipe({ type: 'next_button', maxPages: 10 }));
}

describe('Site permission lifecycle (ADR-037)', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(async () => {
    harness.db.close();
    await harness.db.delete();
    vi.restoreAllMocks();
  });

  it('startJob refuses a site without a persistent grant', async () => {
    await chrome.permissions.remove({ origins: ['https://other.test/*'] });
    const recipe = makeRecipe({ type: 'none' });
    const result = await harness.coordinator.startJob({
      recipe,
      tabId: TAB,
      sourceUrl: 'https://other.test/items',
      pageTitle: 'Other',
    } as never);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/needs access to this site/);
  });

  it('handlePermissionRemoved moves active jobs on that origin to RECOVERABLE with SITE_PERMISSION_REQUIRED', async () => {
    const job = await startPassive(harness);
    await harness.sendFromPage(TAB, makeBatch(job, 1, ['Saved']));

    await harness.coordinator.handlePermissionRemoved([originPatternForUrl(`${BASE_URL}/list`)!]);

    const stored = await harness.job(job.jobId);
    expect(stored?.status).toBe('RECOVERABLE');
    expect(stored?.errors.at(-1)?.code).toBe('SITE_PERMISSION_REQUIRED');
    expect(stored?.errors.at(-1)?.message).toMatch(/needs access to this site/);
    expect(await harness.titles(job.datasetId)).toEqual(['Saved']);
  });

  it('recoverJob refuses without a grant, then resumes after it', async () => {
    const job = await startPassive(harness);
    await harness.coordinator.handleTabClosed(TAB);
    expect((await harness.job(job.jobId))?.status).toBe('RECOVERABLE');

    // Revoke the site, as the user can in chrome://extensions.
    const origin = 'http://localhost:3000/*';
    await chrome.permissions.remove({ origins: [origin] });
    const refused = await harness.coordinator.recoverJob(job.jobId);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/needs access to this site/);
    await chrome.permissions.request({ origins: [origin] });
    // Grant restored: resume proceeds in a fresh tab.
    const resumed = await harness.coordinator.recoverJob(job.jobId);
    expect(resumed.ok).toBe(true);
  });

  it('startJob on a restricted page reports the restricted page, not a missing grant', async () => {
    const result = await harness.coordinator.startJob({
      recipe: makeRecipe({ type: 'none' }),
      tabId: TAB,
      sourceUrl: 'chrome://extensions/',
      pageTitle: 'Extensions',
    } as never);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only available on regular web pages/);
  });

  describe('a new document in a job tab (no static content script)', () => {
    it('starting on a page without the script injects it and runs the job once, as the same page', async () => {
      harness.loadUnscriptedPage(TAB, `${BASE_URL}/list`);
      const extract = vi.fn().mockReturnValue({ accepted: true });
      harness.onInject = (page) => {
        vi.spyOn(page.coordinator, 'extractRecords').mockImplementation(extract);
      };

      const job = await harness.start(TAB, makeRecipe({ type: 'none' }));

      expect(harness.injections).toEqual([TAB]);
      expect(extract).toHaveBeenCalledTimes(1);
      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });

    it('a Next-button job continues on the new document after injecting into it', async () => {
      const job = await startPassive(harness);
      await harness.db.checkpoints.update(job.jobId, { awaitingNavigation: true, expectedUrl: `${BASE_URL}/page-2` });
      harness.loadUnscriptedPage(TAB, `${BASE_URL}/page-2`);
      const extract = vi.fn().mockReturnValue({ accepted: true });
      harness.onInject = (page) => {
        vi.spyOn(page.coordinator, 'extractRecords').mockImplementation(extract);
      };

      await harness.coordinator.handleTabLoaded(TAB);

      expect(extract).toHaveBeenCalledTimes(1);
      expect(await harness.db.checkpoints.get(job.jobId)).toMatchObject({
        awaitingNavigation: false,
        currentUrl: `${BASE_URL}/page-2`,
      });
      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });

    it('a reload during a single-page job is still detected and saves the job for recovery', async () => {
      const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
      vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
      const job = await harness.start(TAB, makeRecipe({ type: 'none' }));
      harness.loadUnscriptedPage(TAB, `${BASE_URL}/list`);

      await harness.coordinator.handleTabLoaded(TAB);

      const stored = await harness.job(job.jobId);
      expect(stored?.status).toBe('RECOVERABLE');
      expect(stored?.interruptedReason).toMatch(/reloaded or changed/);
    });

    it('a page loaded while the job is paused gets the script, and the job stays parked on it', async () => {
      const job = await startPassive(harness);
      await harness.coordinator.pauseJob(job.jobId);
      harness.loadUnscriptedPage(TAB, `${BASE_URL}/page-2`);
      const extract = vi.fn().mockReturnValue({ accepted: true });
      harness.onInject = (page) => {
        vi.spyOn(page.coordinator, 'extractRecords').mockImplementation(extract);
      };

      await harness.coordinator.handleTabLoaded(TAB);

      expect(harness.injections).toContain(TAB);
      expect(extract).not.toHaveBeenCalled();
      expect(await harness.db.checkpoints.get(job.jobId)).toMatchObject({
        awaitingNavigation: true,
        currentUrl: `${BASE_URL}/page-2`,
      });
      expect((await harness.job(job.jobId))?.status).toBe('PAUSED');
    });

    it('saves a running job for recovery when its granted tab can no longer be scripted', async () => {
      const job = await startPassive(harness);
      await harness.sendFromPage(TAB, makeBatch(job, 1, ['Saved']));
      harness.unloadPage(TAB);

      await harness.coordinator.handleTabLoaded(TAB);

      const stored = await harness.job(job.jobId);
      expect(stored?.status).toBe('RECOVERABLE');
      expect(stored?.interruptedReason).toMatch(/could not reach it/);
      expect(await harness.titles(job.datasetId)).toEqual(['Saved']);
    });

    it('saves the job with SITE_PERMISSION_REQUIRED when the page loads after the grant is gone', async () => {
      const job = await startPassive(harness);
      harness.unloadPage(TAB);
      await chrome.permissions.remove({ origins: ['http://localhost:3000/*'] });

      await harness.coordinator.handleTabLoaded(TAB);

      const stored = await harness.job(job.jobId);
      expect(stored?.status).toBe('RECOVERABLE');
      expect(stored?.errors.at(-1)?.code).toBe('SITE_PERMISSION_REQUIRED');
    });

    it('keeps waiting for an expected page that cannot be scripted yet (load grace period decides)', async () => {
      const scheduled: Array<() => void> = [];
      harness = new ExtensionHarness({ schedule: (callback) => scheduled.push(callback) });
      const job = await startPassive(harness);
      await harness.db.checkpoints.update(job.jobId, { awaitingNavigation: true, expectedUrl: `${BASE_URL}/page-2` });
      harness.unloadPage(TAB);

      await harness.coordinator.handleTabLoaded(TAB);

      expect(scheduled).toHaveLength(1);
      expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
    });
  });

  it('two load events for one document start the page once, not twice', async () => {
    // tabs.onUpdated can report "complete" more than once for one document. The first
    // event injects the script and continues the job; the second finds the script
    // already there (__PAGEHARVEST_INJECTED__) and must not send the job again.
    const job = await startPassive(harness);
    await harness.db.checkpoints.update(job.jobId, { awaitingNavigation: true, expectedUrl: `${BASE_URL}/page-2` });
    harness.loadUnscriptedPage(TAB, `${BASE_URL}/page-2`);
    const extract = vi.fn().mockReturnValue({ accepted: true });
    harness.onInject = (page) => {
      vi.spyOn(page.coordinator, 'extractRecords').mockImplementation(extract);
    };
    harness.injections.length = 0;

    await harness.coordinator.handleTabLoaded(TAB);
    await harness.coordinator.handleTabLoaded(TAB);

    expect(harness.injections).toEqual([TAB, TAB]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect((await harness.job(job.jobId))?.status).toBe('RUNNING');
  });
});
