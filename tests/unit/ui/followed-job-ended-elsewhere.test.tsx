import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { JobCoordinator } from '@/background/job-coordinator';
import { FOLLOWED_JOB_STOPPED_NOTICE, useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { MessageRouter } from '@/platform/message-router';
import type { TabInfo } from '@/services/messaging';
import { db } from '@/storage/db';
import { BASE_URL, installBackground, makeRecipe } from '../../utils/job-harness';

/**
 * The panel follows a running job. The job can end without this panel doing it: Chrome has
 * one side panel per window, and the panel in another window can stop it. The followed job
 * then never comes back to "running", so the panel must not keep showing it as collecting
 * (with a spinner, a Pause button and "PageHarvest keeps working") for good.
 */
const TAB: TabInfo = { id: 101, url: `${BASE_URL}/list`, title: 'List', isInjectable: true };

describe('A followed job that ends somewhere else', () => {
  let coordinator: JobCoordinator;
  let router: MessageRouter;

  beforeEach(async () => {
    await db.clearAllData();
    ({ coordinator, router } = installBackground(db));
  });

  afterEach(() => {
    router.stop();
  });

  async function followRunningJob() {
    const started = await coordinator.startJob({
      recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 5 }),
      tabId: TAB.id!,
      sourceUrl: TAB.url,
    });
    if (!started.ok || !started.identity) throw new Error(String(started.error));
    const hook = renderHook(() => useExtractionWorkflow(TAB));
    await waitFor(() => expect(hook.result.current.view).toBe('extracting'));
    expect(hook.result.current.stats.status).toBe('RUNNING');
    return { hook, jobId: started.identity.jobId };
  }

  it('leaves the progress screen and says the rows are kept when the job is stopped in another window', async () => {
    const { hook, jobId } = await followRunningJob();

    expect((await coordinator.cancelJob(jobId)).ok).toBe(true);

    // The panel's own refresh notices; no broadcast is needed.
    await waitFor(() => expect(hook.result.current.view).toBe('dashboard'), { timeout: 5000 });
    expect(hook.result.current.notice).toBe(FOLLOWED_JOB_STOPPED_NOTICE);
    // Nothing on screen still claims to follow a job.
    expect(hook.result.current.stats.status).toBe('IDLE');
    hook.unmount();
  });

  it('says nothing extra when this panel stopped the job itself', async () => {
    const { hook } = await followRunningJob();

    await act(async () => {
      await hook.result.current.cancelExtraction();
    });

    expect(hook.result.current.view).toBe('dashboard');
    expect(hook.result.current.notice).toBeNull();
    hook.unmount();
  });

  it('still opens the results when the job finishes in another window (control)', async () => {
    const { hook, jobId } = await followRunningJob();

    expect((await coordinator.finishJob(jobId)).ok).toBe(true);

    await waitFor(() => expect(hook.result.current.view).toBe('results'), { timeout: 5000 });
    expect(hook.result.current.notice).toBeNull();
    hook.unmount();
  });
});
