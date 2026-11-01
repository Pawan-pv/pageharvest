export interface JobStateSnapshot {
  jobId: string;
  projectId?: string;
  recipeId?: string;
  url: string;
  status: 'running' | 'paused' | 'suspended' | 'completed' | 'failed';
  pagesVisited: number;
  totalExtracted: number;
  duplicatesSkipped: number;
  lastCheckpointAt: number;
}

const STORAGE_KEY = '__pageharvest_active_job__';

/**
 * Persists active extraction job state into durable chrome.storage.local
 * to withstand Chrome service worker suspensions and unexpected reboots.
 */
export async function persistJobState(state: JobStateSnapshot): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEY]: state
  });
}

/**
 * Retrieves the current persisted job state from durable storage.
 */
export async function getPersistedJobState(): Promise<JobStateSnapshot | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }

  const result = await chrome.storage.local.get(STORAGE_KEY);
  const data = result ? result[STORAGE_KEY] : null;
  return data || null;
}

/**
 * Clears active job state once an extraction has terminated or completed cleanly.
 */
export async function clearJobState(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }

  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Updates progress counters atomically during extraction steps.
 */
export async function checkpointJobProgress(
  jobId: string,
  progress: {
    page?: number;
    newExtractedCount?: number;
    duplicatesCount?: number;
  }
): Promise<void> {
  const current = await getPersistedJobState();
  if (!current || current.jobId !== jobId) {
    return;
  }

  const updated: JobStateSnapshot = {
    ...current,
    pagesVisited: progress.page ?? current.pagesVisited,
    totalExtracted: current.totalExtracted + (progress.newExtractedCount ?? 0),
    duplicatesSkipped: current.duplicatesSkipped + (progress.duplicatesCount ?? 0),
    lastCheckpointAt: Date.now()
  };

  await persistJobState(updated);
}

/**
 * Evaluates stored state upon Service Worker start or extension launch.
 * Detects whether a previous job was interrupted mid-flight.
 */
export async function recoverJobState(): Promise<{
  recovered: boolean;
  job?: JobStateSnapshot;
  reason?: string;
}> {
  const state = await getPersistedJobState();
  if (!state) {
    return { recovered: false };
  }

  if (state.status === 'running') {
    // Service worker was suspended while extraction was marked as running
    const recoveredJob: JobStateSnapshot = {
      ...state,
      status: 'suspended'
    };
    await persistJobState(recoveredJob);

    return {
      recovered: true,
      job: recoveredJob,
      reason: 'Extraction job was interrupted by background service worker suspension.'
    };
  }

  if (state.status === 'suspended') {
    return {
      recovered: true,
      job: state,
      reason: 'Previously suspended job found in durable storage.'
    };
  }

  return {
    recovered: false,
    job: state
  };
}
