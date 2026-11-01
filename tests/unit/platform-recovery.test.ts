import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  persistJobState,
  getPersistedJobState,
  clearJobState,
  checkpointJobProgress,
  recoverJobState,
  JobStateSnapshot
} from '@/platform/job-recovery';

describe('Service Worker Reliability & Durable Job State Recovery', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    (globalThis as any).chrome = mockChrome;
  });

  it('persists active job state into durable chrome.storage.local', async () => {
    const snapshot: JobStateSnapshot = {
      jobId: 'job_harvest_101',
      projectId: 'proj_amazon',
      recipeId: 'rec_amazon_laptops',
      url: 'https://example.com/laptops',
      status: 'running',
      pagesVisited: 3,
      totalExtracted: 60,
      duplicatesSkipped: 4,
      lastCheckpointAt: Date.now()
    };

    await persistJobState(snapshot);

    const stored = await getPersistedJobState();
    expect(stored).toBeDefined();
    expect(stored?.jobId).toBe('job_harvest_101');
    expect(stored?.pagesVisited).toBe(3);
    expect(stored?.totalExtracted).toBe(60);
    expect(stored?.status).toBe('running');
  });

  it('updates progress counters during job checkpointing', async () => {
    const initial: JobStateSnapshot = {
      jobId: 'job_checkpoint_test',
      url: 'https://example.com/items',
      status: 'running',
      pagesVisited: 1,
      totalExtracted: 20,
      duplicatesSkipped: 0,
      lastCheckpointAt: Date.now()
    };
    await persistJobState(initial);

    await checkpointJobProgress('job_checkpoint_test', {
      page: 2,
      newExtractedCount: 20,
      duplicatesCount: 2
    });

    const updated = await getPersistedJobState();
    expect(updated?.pagesVisited).toBe(2);
    expect(updated?.totalExtracted).toBe(40);
    expect(updated?.duplicatesSkipped).toBe(2);
  });

  it('detects and recovers an interrupted job after service worker suspension / restart', async () => {
    const interruptedJob: JobStateSnapshot = {
      jobId: 'job_interrupted_99',
      projectId: 'proj_ecommerce',
      url: 'https://example.com/store',
      status: 'running',
      pagesVisited: 5,
      totalExtracted: 100,
      duplicatesSkipped: 8,
      lastCheckpointAt: Date.now() - 60000 // 1 minute ago
    };
    await persistJobState(interruptedJob);

    // Simulate service worker reboot and call recoverJobState()
    const recoveryResult = await recoverJobState();
    expect(recoveryResult.recovered).toBe(true);
    expect(recoveryResult.job).toBeDefined();
    expect(recoveryResult.job?.jobId).toBe('job_interrupted_99');
    expect(recoveryResult.job?.status).toBe('suspended');
  });

  it('returns recovered = false when no job was active', async () => {
    await clearJobState();
    const result = await recoverJobState();
    expect(result.recovered).toBe(false);
    expect(result.job).toBeUndefined();
  });

  it('clears persisted state when a job completes or is cancelled', async () => {
    const job: JobStateSnapshot = {
      jobId: 'job_to_clear',
      url: 'https://example.com',
      status: 'running',
      pagesVisited: 1,
      totalExtracted: 10,
      duplicatesSkipped: 0,
      lastCheckpointAt: Date.now()
    };
    await persistJobState(job);

    await clearJobState();
    const stored = await getPersistedJobState();
    expect(stored).toBeNull();
  });
});
