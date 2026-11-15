import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createContentWorkflowCoordinator } from '@/content/workflow-coordinator';
import type { ExtensionMessage } from '@/contracts/messages';
import { RecoveryBanner } from '@/components/shell/RecoveryBanner';
import type { ExtractionJob } from '@/shared/contracts/job';
import { PageHarvestDB } from '@/storage/db';
import { BASE_URL, installBackground, makeRecipe, uniqueDb } from '../utils/job-harness';

const TAB = 901;
const identity = { jobId: 'job_1', projectId: 'project_1', datasetId: 'dataset_1', runId: 'run_1', generation: 'gen_1' };

function extractMessage(): Extract<ExtensionMessage, { type: 'EXTRACT_RECORDS' }> {
  return {
    id: 'extract_1',
    type: 'EXTRACT_RECORDS',
    timestamp: 1,
    payload: {
      identity,
      recipe: makeRecipe({ type: 'none' }),
      resume: {
        page: 2,
        nextSequence: 2,
        recordsExtracted: 3,
        scrollsCompleted: 0,
        catchUpScrolls: 0,
        visitedUrls: [],
        startUrl: `${BASE_URL}/list`,
      },
    },
  } as Extract<ExtensionMessage, { type: 'EXTRACT_RECORDS' }>;
}

/**
 * "The site asked PageHarvest to slow down" is shown only for a real signal: the page a job
 * is on was answered with HTTP 429 Too Many Requests, which the page reads from its own
 * navigation timing entry (responseStatus).
 */
describe('A page answered with 429 Too Many Requests', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="card"><span class="title">Row</span></div>';
  });

  function runOn(status: number | undefined) {
    const sent: ExtensionMessage[] = [];
    const coordinator = createContentWorkflowCoordinator(() => undefined, document, {
      getCurrentUrl: () => `${BASE_URL}/list?page=2`,
      getDocumentStatus: () => status,
      sendToBackground: async (message) => {
        sent.push(message);
        if (message.type === 'RECORD_BATCH') {
          return { status: 'committed', sequence: message.payload.sequence, inserted: 1, duplicates: 0 };
        }
        return { status: 'committed', sequence: 1, inserted: 0, duplicates: 0 };
      },
    });
    coordinator.extractRecords(extractMessage());
    return { coordinator, sent };
  }

  it('stops the job as one that can continue later, with the RATE_LIMITED code, and reads nothing', async () => {
    const { coordinator, sent } = runOn(429);
    await coordinator.runSettled();

    expect(sent.map((message) => message.type)).toEqual(['JOB_FAILED']);
    const failed = sent[0] as Extract<ExtensionMessage, { type: 'JOB_FAILED' }>;
    expect(failed.payload).toMatchObject({ identity, code: 'RATE_LIMITED', recoverable: true });
    expect(failed.payload.message).toMatch(/429/);
  });

  it('reads the page as usual for any other answer, or when the browser does not say', async () => {
    for (const status of [200, undefined]) {
      const { coordinator, sent } = runOn(status);
      await coordinator.runSettled();
      expect(sent.map((message) => message.type)).toContain('RECORD_BATCH');
      expect(sent.some((message) => message.type === 'JOB_FAILED')).toBe(false);
    }
  });
});

describe('The background keeps the reason a rate-limited job stopped', () => {
  let db: PageHarvestDB;

  beforeEach(() => {
    db = uniqueDb();
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('makes the job recoverable and stores RATE_LIMITED as its latest error', async () => {
    const { coordinator } = installBackground(db);
    const started = await coordinator.startJob({ recipe: makeRecipe({ type: 'next_button' }), tabId: TAB, sourceUrl: `${BASE_URL}/list` });
    const id = started.identity;
    expect(id).toBeDefined();
    if (!id) return;

    await coordinator.reportJobFailure(
      {
        identity: id,
        message: 'The site answered 429 Too Many Requests.',
        category: 'PAGINATION_FAILED',
        code: 'RATE_LIMITED',
        recoverable: true,
      },
      { tabId: TAB }
    );

    const job = await db.jobs.get(id.jobId);
    expect(job?.status).toBe('RECOVERABLE');
    expect(job?.errors.at(-1)?.code).toBe('RATE_LIMITED');
  });
});

describe('The panel says why a rate-limited job stopped', () => {
  const job = {
    id: 'job_1',
    targetUrl: `${BASE_URL}/list`,
    status: 'RECOVERABLE',
    progressKind: 'pages',
    pagesVisited: 2,
    scrollsCompleted: 0,
    targetSteps: 5,
    totalExtracted: 40,
    interruptedReason: 'The site answered 429 Too Many Requests.',
    errors: [
      { id: 'e1', category: 'PAGINATION_FAILED', severity: 'WARN', code: 'RATE_LIMITED', message: 'The site answered 429 Too Many Requests.', timestamp: 1 },
    ],
  } as unknown as ExtractionJob;

  it.each([true, false])('names the slow-down and what to do (simple: %s)', (simple) => {
    render(<RecoveryBanner job={job} simple={simple} onResume={() => undefined} onDiscard={() => undefined} />);
    expect(screen.getByText('The site asked PageHarvest to slow down')).toBeInTheDocument();
    expect(screen.getByText(/Wait a few minutes/)).toBeInTheDocument();
    expect(screen.getByText(/40 rows saved and safe/)).toBeInTheDocument();
  });
});
