import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { JobCoordinator } from '@/background/job-coordinator';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { MessageRouter } from '@/platform/message-router';
import { messagingService, type TabInfo } from '@/services/messaging';
import { db } from '@/storage/db';
import { BASE_URL, installBackground, makeRecipe } from '../../utils/job-harness';

/**
 * A double click on Continue (stopped-early banner) resumes the session once and leaves no
 * error behind: the second click is not a failure the person should read about later.
 */
const TAB: TabInfo = { id: 102, url: `${BASE_URL}/list`, title: 'List', isInjectable: true };

describe('Continue pressed twice in the panel', () => {
  let coordinator: JobCoordinator;
  let router: MessageRouter;

  beforeEach(async () => {
    await db.clearAllData();
    ({ coordinator, router } = installBackground(db));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    router.stop();
  });

  it('sends one resume, follows the job, and shows no error', async () => {
    const started = await coordinator.startJob({
      recipe: makeRecipe({ type: 'next_button', nextButtonSelector: '.next', maxPages: 5 }),
      tabId: TAB.id!,
      sourceUrl: TAB.url,
    });
    if (!started.ok || !started.identity) throw new Error(String(started.error));
    await coordinator.handleTabClosed(TAB.id!);
    const jobId = started.identity.jobId;

    const hook = renderHook(() => useExtractionWorkflow(TAB));
    await waitFor(() => expect(hook.result.current.recoverableJobs.map((j) => j.id)).toEqual([jobId]));
    const sent = vi.spyOn(messagingService, 'recoverJob');

    await act(async () => {
      await Promise.all([hook.result.current.recoverJob(jobId), hook.result.current.recoverJob(jobId)]);
    });

    expect(sent).toHaveBeenCalledTimes(1);
    expect((await db.jobs.get(jobId))?.status).toBe('RUNNING');
    expect(hook.result.current.view).toBe('extracting');
    expect(hook.result.current.operationError).toBeNull();
    hook.unmount();
  });
});
