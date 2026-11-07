import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { HarvestErrorSchema, ExtractionErrorCodeSchema } from '@/shared/contracts/error';
import { jobFailedMessageSchema } from '@/shared/contracts/message';
import { ErrorReporter, codeForCategory } from '@/core/resilience/error-reporter';
import { NavigationJobError } from '@/core/navigation/runner';
import { ErrorBanner } from '@/components/common/ErrorBanner';
import { ERROR_COPY } from '@/components/common/errorCopy';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { messagingService, type MessageListener, type TabInfo } from '@/services/messaging';
import type { ExtensionMessage } from '@/contracts/messages';
import type { ErrorCategory } from '@/types';
import { db } from '@/storage/db';
import { ProjectRepository } from '@/storage/repositories';
import { ExtensionHarness, makeRecipe, renderCards, BASE_URL } from '../utils/job-harness';

describe('Error codes in the contract', () => {
  const base = { id: 'e1', category: 'UNKNOWN', severity: 'ERROR', message: 'x', timestamp: 1 } as const;

  it('keeps stored errors without a code valid', () => {
    expect(HarvestErrorSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a known code and rejects an unknown one', () => {
    expect(HarvestErrorSchema.parse({ ...base, code: 'TAB_DISCONNECTED' }).code).toBe('TAB_DISCONNECTED');
    expect(HarvestErrorSchema.safeParse({ ...base, code: 'NOPE' }).success).toBe(false);
  });

  it('lets JOB_FAILED carry a code', () => {
    const parsed = jobFailedMessageSchema.parse({
      id: 'm',
      type: 'JOB_FAILED',
      timestamp: 1,
      payload: {
        identity: { jobId: 'j', projectId: 'p', datasetId: 'd', runId: 'r', generation: 'g' },
        message: 'The next page could not be opened.',
        category: 'PAGINATION_FAILED',
        code: 'PAGINATION_TIMEOUT',
      },
    });
    expect(parsed.payload.code).toBe('PAGINATION_TIMEOUT');
  });
});

describe('ErrorReporter codes', () => {
  it.each<[ErrorCategory, string]>([
    ['STORAGE_FAILED', 'STORAGE_ERROR'],
    ['RUNTIME_MESSAGING', 'TAB_DISCONNECTED'],
    ['SELECTOR_NOT_FOUND', 'CONTAINER_NOT_FOUND'],
    ['PAGINATION_FAILED', 'UNKNOWN_ERROR'],
    ['VALIDATION_FAILED', 'UNKNOWN_ERROR'],
    ['DOM_PARSING', 'UNKNOWN_ERROR'],
    ['CIRCUIT_BREAKER_TRIGGERED', 'UNKNOWN_ERROR'],
    ['UNKNOWN', 'UNKNOWN_ERROR'],
  ])('gives %s the default code %s', (category, code) => {
    expect(codeForCategory(category)).toBe(code);
    expect(new ErrorReporter().report(category, 'boom').code).toBe(code);
  });

  it('uses an explicit code over the default', () => {
    expect(new ErrorReporter().report('PAGINATION_FAILED', 'x', { code: 'PAGINATION_TIMEOUT' }).code).toBe(
      'PAGINATION_TIMEOUT'
    );
  });

  it('every default is a real code', () => {
    for (const category of [
      'DOM_PARSING',
      'SELECTOR_NOT_FOUND',
      'PAGINATION_FAILED',
      'STORAGE_FAILED',
      'RUNTIME_MESSAGING',
      'VALIDATION_FAILED',
      'CIRCUIT_BREAKER_TRIGGERED',
      'UNKNOWN',
    ] as ErrorCategory[]) {
      expect(ExtractionErrorCodeSchema.safeParse(codeForCategory(category)).success).toBe(true);
    }
  });
});

describe('NavigationJobError codes', () => {
  it('defaults to UNKNOWN_ERROR and keeps an explicit code', () => {
    expect(new NavigationJobError('x').code).toBe('UNKNOWN_ERROR');
    expect(new NavigationJobError('bad template', 'VALIDATION_ERROR').code).toBe('VALIDATION_ERROR');
  });
});

describe('Codes travel from the page to the stored job', () => {
  let harness: ExtensionHarness;
  const TAB = 7;

  beforeEach(() => {
    harness = new ExtensionHarness();
  });

  afterEach(() => {
    harness.db.close();
    vi.restoreAllMocks();
  });

  it('stores the code a failing page reports, and broadcasts it', async () => {
    renderCards(['Alpha']);
    const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
    // Keep the page passive, so the job is still running when the page reports a failure.
    vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
    const running = await harness.start(TAB, makeRecipe({ type: 'next_button', maxPages: 10 }));
    await harness.sendFromPage(TAB, {
      id: 'failed',
      type: 'JOB_FAILED',
      timestamp: 1,
      payload: {
        identity: running,
        message: 'The next page could not be opened.',
        category: 'PAGINATION_FAILED',
        code: 'PAGINATION_TIMEOUT',
        recoverable: false,
      },
    });

    const stored = await harness.job(running.jobId);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.errors.at(-1)?.code).toBe('PAGINATION_TIMEOUT');
    const broadcast = harness.broadcasts.find(
      (message): message is Extract<ExtensionMessage, { type: 'EXTRACTION_ERROR' }> =>
        message.type === 'EXTRACTION_ERROR'
    );
    expect(broadcast?.payload.code).toBe('PAGINATION_TIMEOUT');
  });
});

const tab: TabInfo = { id: 101, url: 'https://shop.test/items', title: 'Shop', isInjectable: true };

function Probe() {
  const workflow = useExtractionWorkflow(tab);
  return (
    <>
      <button onClick={() => workflow.loadSchema(makeRecipe())}>Load</button>
      <button onClick={() => workflow.fields.forEach((field) => workflow.toggleFieldSelection(field.id))}>
        Clear fields
      </button>
      <button onClick={() => void workflow.startExtraction()}>Start</button>
      <output data-testid="fields">{workflow.selectedFieldIds.size}</output>
      <output data-testid="code">{workflow.operationError?.code ?? 'none'}</output>
      <output data-testid="message">{workflow.operationError?.message ?? 'none'}</output>
    </>
  );
}

/**
 * loadSchema also loads projects in the background. Answer it at once and flush it inside the
 * test, so no state update lands after the test environment is torn down.
 */
async function settleBackgroundLoads() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function answerProjectsAtOnce() {
  vi.spyOn(ProjectRepository.prototype, 'getAllProjects').mockResolvedValue([]);
}

describe('The panel receives codes', () => {
  let listener: MessageListener | undefined;

  beforeEach(async () => {
    await db.clearAllData();
    vi.spyOn(messagingService, 'subscribe').mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    listener = undefined;
  });

  it('keeps the code from EXTRACTION_ERROR', async () => {
    render(<Probe />);
    await waitFor(() => expect(listener).toBeDefined());
    act(() =>
      listener?.({
        id: 'e',
        type: 'EXTRACTION_ERROR',
        timestamp: 1,
        payload: {
          id: 'e',
          category: 'RUNTIME_MESSAGING',
          code: 'TAB_DISCONNECTED',
          severity: 'ERROR',
          message: 'Receiving end does not exist.',
          timestamp: 1,
        },
      })
    );
    expect(screen.getByTestId('code')).toHaveTextContent('TAB_DISCONNECTED');
    expect(screen.getByTestId('message')).toHaveTextContent('Receiving end does not exist.');
  });

  it('marks the panel’s own setup checks as VALIDATION_ERROR', async () => {
    answerProjectsAtOnce();
    render(<Probe />);
    act(() => screen.getByRole('button', { name: 'Load' }).click());
    await waitFor(() => expect(Number(screen.getByTestId('fields').textContent)).toBeGreaterThan(0));
    act(() => screen.getByRole('button', { name: 'Clear fields' }).click());
    await waitFor(() => expect(screen.getByTestId('fields')).toHaveTextContent('0'));
    act(() => screen.getByRole('button', { name: 'Start' }).click());
    await waitFor(() => expect(screen.getByTestId('code')).toHaveTextContent('VALIDATION_ERROR'));
    expect(screen.getByTestId('message')).toHaveTextContent('Select at least one field to extract.');
    await settleBackgroundLoads();
  });
});

describe('ErrorBanner for setup problems', () => {
  it('shows the setup message itself, because VALIDATION_ERROR messages are written for people', () => {
    render(<ErrorBanner error={{ code: 'VALIDATION_ERROR', message: 'Select at least one field to extract.' }} />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(ERROR_COPY.VALIDATION_ERROR.title);
    expect(banner).toHaveTextContent('Select at least one field to extract.');
    expect(banner).not.toHaveTextContent(ERROR_COPY.VALIDATION_ERROR.whatHappened);
  });

  it('keeps other messages behind the disclosure', () => {
    render(<ErrorBanner error={{ code: 'TAB_DISCONNECTED', message: 'Receiving end does not exist.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_COPY.TAB_DISCONNECTED.whatHappened);
    expect(screen.getByText(/Receiving end does not exist/).closest('details')).not.toBeNull();
  });
});
