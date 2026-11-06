import {
  BatchAck,
  BatchAckSchema,
  ContentCommandResult,
  ExtensionMessage,
  JobNavigationState,
  JobRunStatus,
  extensionMessageSchema,
} from '@/contracts/messages';
import { fieldDefinitionSchema } from '@/contracts/schemas';
import {
  autoDetectLists,
  detectFieldsInContainer,
  detectListFromSelection,
  suggestionsToFieldDefinitions,
} from '@/core/detection';
import {
  CommitOutcome,
  JobBatchPayload,
  NavigationJobError,
  NavigationJobOptions,
  runNavigationJob,
} from '@/core/navigation/runner';
import { errorReporter } from '@/core/resilience/error-reporter';
import { JobIdentity } from '@/shared/contracts/job';

type DetectRepeatedElementsMessage = Extract<ExtensionMessage, { type: 'DETECT_REPEATED_ELEMENTS' }>;
type DetectFieldsMessage = Extract<ExtensionMessage, { type: 'DETECT_FIELDS' }>;
type ExtractRecordsMessage = Extract<ExtensionMessage, { type: 'EXTRACT_RECORDS' }>;
type ControlJobMessage = Extract<ExtensionMessage, { type: 'CONTROL_JOB' }>;

export interface ContentWorkflowCoordinator {
  detectRepeatedElements(
    message: DetectRepeatedElementsMessage
  ): Promise<Extract<ExtensionMessage, { type: 'REPEATED_ELEMENTS_DETECTED' }>>;
  detectFields(
    message: DetectFieldsMessage
  ): Promise<Extract<ExtensionMessage, { type: 'FIELDS_DETECTED' }>>;
  /** Starts the job on this document and replies at once; progress goes to the background. */
  extractRecords(message: ExtractRecordsMessage): ContentCommandResult;
  controlJob(message: ControlJobMessage): ContentCommandResult;
  queryJobRun(): JobRunStatus;
  /** Resolves once the current run, if any, has ended. */
  runSettled(): Promise<void>;
}

type MessageEmitter = (message: ExtensionMessage) => unknown;

export interface ContentWorkflowOptions {
  /** Request/response delivery to the background worker. */
  sendToBackground?: (message: ExtensionMessage) => Promise<unknown>;
  getCurrentUrl?: () => string;
  navigateUrl?: (url: string) => void | Promise<void>;
  deliveryAttempts?: number;
  deliveryRetryDelayMs?: number;
  engineOverrides?: NavigationJobOptions['engineOverrides'];
}

function messageId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createContentWorkflowMessage<T>(message: T): T {
  return extensionMessageSchema.parse(message) as T;
}

/** The background refused the job's message for good. The run stops quietly. */
class JobRejectedError extends Error {}

/** The background could not be reached or could not store. The job is recoverable. */
class BatchDeliveryError extends Error {}

const RETRYABLE_REJECTIONS = new Set(['persist_failed']);

interface ActiveRun {
  identity: JobIdentity;
  controller: AbortController;
  paused: boolean;
  resumeWaiters: Array<() => void>;
  nextSequence: number;
  settled: Promise<void>;
}

export function createContentWorkflowCoordinator(
  emit: MessageEmitter,
  root: Document = document,
  options: ContentWorkflowOptions = {}
): ContentWorkflowCoordinator {
  const deliveryAttempts = options.deliveryAttempts ?? 5;
  const deliveryRetryDelayMs = options.deliveryRetryDelayMs ?? 750;
  const getCurrentUrl = options.getCurrentUrl ?? (() => root.location?.href ?? '');
  const navigateTo =
    options.navigateUrl ??
    ((url: string) => {
      window.location.assign(url);
    });

  let activeRun: ActiveRun | null = null;

  const publish = async <T>(message: T): Promise<T> => {
    const validated = createContentWorkflowMessage(message);
    await emit(validated as ExtensionMessage);
    return validated;
  };

  const releasePause = (run: ActiveRun): void => {
    run.paused = false;
    const waiters = run.resumeWaiters;
    run.resumeWaiters = [];
    waiters.forEach((resolve) => resolve());
  };

  const abortRun = (run: ActiveRun): void => {
    run.controller.abort();
    releasePause(run);
  };

  /**
   * Delivers a message that must be acknowledged. Retries cover a service worker that
   * is restarting and a storage failure; each retry repeats the same sequence number,
   * so the background cannot apply it twice.
   */
  const deliver = async (run: ActiveRun, build: () => ExtensionMessage): Promise<BatchAck> => {
    if (!options.sendToBackground) {
      throw new BatchDeliveryError('No connection to the background worker.');
    }

    let lastFailure = 'no reply';
    for (let attempt = 1; attempt <= deliveryAttempts; attempt++) {
      if (run.controller.signal.aborted) {
        throw new JobRejectedError('The run was stopped.');
      }

      try {
        const reply = await options.sendToBackground(build());
        const parsed = BatchAckSchema.safeParse(reply);
        if (parsed.success) {
          const ack = parsed.data;
          if (ack.status !== 'rejected') return ack;
          if (!ack.reason || !RETRYABLE_REJECTIONS.has(ack.reason)) {
            throw new JobRejectedError(ack.reason ?? 'rejected');
          }
          lastFailure = ack.reason;
        } else {
          lastFailure = 'unexpected reply';
        }
      } catch (error: unknown) {
        if (error instanceof JobRejectedError) throw error;
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      if (attempt < deliveryAttempts) {
        await new Promise((resolve) => setTimeout(resolve, deliveryRetryDelayMs * attempt));
      }
    }

    throw new BatchDeliveryError(`Records could not be saved (${lastFailure}).`);
  };

  const commitBatch = async (run: ActiveRun, batch: JobBatchPayload): Promise<CommitOutcome> => {
    const sequence = run.nextSequence;
    const ack = await deliver(run, () =>
      createContentWorkflowMessage({
        id: messageId('batch'),
        type: 'RECORD_BATCH' as const,
        timestamp: Date.now(),
        payload: {
          identity: run.identity,
          sequence,
          page: batch.page,
          records: batch.records,
          stats: batch.stats,
          navigation: batch.navigation,
        },
      })
    );
    run.nextSequence = sequence + 1;
    return { inserted: ack.inserted, shouldStop: ack.shouldStop === true };
  };

  const commitCheckpoint = async (run: ActiveRun, navigation: JobNavigationState): Promise<void> => {
    await deliver(run, () =>
      createContentWorkflowMessage({
        id: messageId('checkpoint'),
        type: 'JOB_CHECKPOINT' as const,
        timestamp: Date.now(),
        payload: { identity: run.identity, navigation },
      })
    );
  };

  const executeRun = async (run: ActiveRun, message: ExtractRecordsMessage): Promise<void> => {
    try {
      const outcome = await runNavigationJob({
        recipe: message.payload.recipe,
        resume: message.payload.resume,
        root,
        signal: run.controller.signal,
        getCurrentUrl,
        waitWhilePaused: () =>
          run.paused
            ? new Promise<void>((resolve) => run.resumeWaiters.push(resolve))
            : Promise.resolve(),
        commitBatch: (batch) => commitBatch(run, batch),
        commitCheckpoint: (navigation) => commitCheckpoint(run, navigation),
        navigateTo,
        engineOverrides: options.engineOverrides,
      });

      if (outcome.kind !== 'finished' || run.controller.signal.aborted) return;
      // The background already ended the job when it told the run to stop.
      if (outcome.stopReason === 'stopped_by_coordinator') return;

      await deliver(run, () =>
        createContentWorkflowMessage({
          id: messageId('finished'),
          type: 'JOB_FINISHED' as const,
          timestamp: Date.now(),
          payload: {
            identity: run.identity,
            lastSequence: run.nextSequence - 1,
            stopReason: outcome.stopReason,
          },
        })
      );
    } catch (error: unknown) {
      if (error instanceof JobRejectedError || run.controller.signal.aborted) return;

      const text = error instanceof Error ? error.message : String(error);
      const recoverable = error instanceof BatchDeliveryError;
      const category = error instanceof NavigationJobError ? 'PAGINATION_FAILED' : 'DOM_PARSING';
      const reported = errorReporter.report(recoverable ? 'RUNTIME_MESSAGING' : category, error, {
        context: { jobId: run.identity.jobId },
        code: !recoverable && error instanceof NavigationJobError ? error.code : undefined,
      });

      await options
        .sendToBackground?.(
          createContentWorkflowMessage({
            id: messageId('failed'),
            type: 'JOB_FAILED' as const,
            timestamp: Date.now(),
            payload: {
              identity: run.identity,
              message: text,
              category: recoverable ? ('RUNTIME_MESSAGING' as const) : category,
              code: reported.code,
              recoverable,
            },
          })
        )
        .catch(() => undefined);
    }
  };

  return {
    async detectRepeatedElements(message) {
      const targetSelector = message.payload?.targetSelector;
      const result = targetSelector
        ? (() => {
            const target = root.querySelector(targetSelector);
            if (!target) {
              throw new Error(`The selected element could not be found for selector "${targetSelector}".`);
            }
            return detectListFromSelection(target);
          })()
        : autoDetectLists(root)[0] ?? null;

      if (!result) {
        throw new Error('No repeated list or table rows were detected on this page.');
      }

      return publish({
        id: messageId('repeated'),
        type: 'REPEATED_ELEMENTS_DETECTED',
        timestamp: Date.now(),
        payload: {
          containerSelector: result.containerSelector,
          matchCount: result.itemCount,
          sampleSnippets: result.sampleElements.map((sample) => sample.previewText),
        },
      });
    },

    async detectFields(message) {
      const containers = Array.from(root.querySelectorAll(message.payload.containerSelector));
      const firstContainer = containers[0];
      if (!firstContainer) {
        throw new Error(
          `No elements matched the container selector "${message.payload.containerSelector}".`
        );
      }

      const suggestions = suggestionsToFieldDefinitions(detectFieldsInContainer(firstContainer)).map(
        (field) => fieldDefinitionSchema.parse(field)
      );
      return publish({
        id: messageId('fields'),
        type: 'FIELDS_DETECTED',
        timestamp: Date.now(),
        payload: {
          containerSelector: message.payload.containerSelector,
          suggestedFields: suggestions,
        },
      });
    },

    extractRecords(message) {
      // A new generation supersedes anything still running in this document.
      if (activeRun) abortRun(activeRun);

      const run: ActiveRun = {
        identity: message.payload.identity,
        controller: new AbortController(),
        paused: false,
        resumeWaiters: [],
        nextSequence: message.payload.resume.nextSequence,
        settled: Promise.resolve(),
      };
      activeRun = run;
      run.settled = executeRun(run, message).finally(() => {
        if (activeRun === run) activeRun = null;
      });

      return { accepted: true };
    },

    controlJob(message) {
      const run = activeRun;
      const { identity, action } = message.payload;
      if (!run || run.identity.jobId !== identity.jobId) {
        return { accepted: false, reason: 'no_active_run' };
      }
      // An abort names the generation the job had while running, so it matches; pause and
      // resume must match exactly, so a stale control cannot move a newer run.
      if (run.identity.generation !== identity.generation) {
        return { accepted: false, reason: 'stale_generation' };
      }

      if (action === 'pause') {
        run.paused = true;
      } else if (action === 'resume') {
        releasePause(run);
      } else {
        abortRun(run);
      }
      return { accepted: true };
    },

    queryJobRun() {
      if (!activeRun) return { active: false };
      return {
        active: true,
        jobId: activeRun.identity.jobId,
        generation: activeRun.identity.generation,
        paused: activeRun.paused,
      };
    },

    runSettled() {
      return activeRun ? activeRun.settled : Promise.resolve();
    },
  };
}
