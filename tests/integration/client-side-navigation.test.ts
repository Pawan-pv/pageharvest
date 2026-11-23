import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionHarness, BASE_URL, makeRecipe, renderCards } from '../utils/job-harness';

/**
 * A job clicks Next and the page changes its address without loading a new document
 * (a client-side route). The background must not mistake that for a page that failed to
 * load: the document is still there, still running the job (ADR-033).
 */
const TAB = 21;

describe('A Next click that stays in the same document', () => {
  let harness: ExtensionHarness;

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(() => {
    harness.db.close();
    vi.restoreAllMocks();
  });

  /** A running job whose checkpoint says it is waiting for the next page. */
  async function jobWaitingForNavigation() {
    renderCards(['One']);
    const page = harness.loadPage(TAB, `${BASE_URL}/list`);
    vi.spyOn(page.coordinator, 'extractRecords').mockReturnValue({ accepted: true });
    const identity = await harness.start(TAB, makeRecipe({ type: 'next_button', maxPages: 5 }));
    await harness.db.checkpoints.update(identity.jobId, {
      awaitingNavigation: true,
      expectedUrl: `${BASE_URL}/list?page=2`,
    });
    return { page, identity };
  }

  it('is not interrupted while the page still runs this job', async () => {
    const { page, identity } = await jobWaitingForNavigation();
    const job = await harness.job(identity.jobId);
    vi.spyOn(page.coordinator, 'queryJobRun').mockReturnValue({
      active: true,
      jobId: identity.jobId,
      generation: job?.generation,
      paused: false,
    });

    await harness.coordinator.checkPendingNavigation(identity.jobId, TAB);

    expect((await harness.job(identity.jobId))?.status).toBe('RUNNING');
  });

  it('is still interrupted when no document answers, because the load really failed', async () => {
    const { identity } = await jobWaitingForNavigation();
    harness.unloadPage(TAB);

    await harness.coordinator.checkPendingNavigation(identity.jobId, TAB);

    const job = await harness.job(identity.jobId);
    expect(job?.status).toBe('RECOVERABLE');
    expect(job?.interruptedReason).toMatch(/failed to load/);
  });

  it('is still interrupted when the page answers for a different run', async () => {
    const { page, identity } = await jobWaitingForNavigation();
    vi.spyOn(page.coordinator, 'queryJobRun').mockReturnValue({
      active: true,
      jobId: identity.jobId,
      generation: 'some-older-generation',
      paused: false,
    });

    await harness.coordinator.checkPendingNavigation(identity.jobId, TAB);

    expect((await harness.job(identity.jobId))?.status).toBe('RECOVERABLE');
  });

  it('is still interrupted when the page is idle', async () => {
    const { page, identity } = await jobWaitingForNavigation();
    vi.spyOn(page.coordinator, 'queryJobRun').mockReturnValue({ active: false });

    await harness.coordinator.checkPendingNavigation(identity.jobId, TAB);

    expect((await harness.job(identity.jobId))?.status).toBe('RECOVERABLE');
  });
});
