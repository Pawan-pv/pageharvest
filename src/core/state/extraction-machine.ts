import { ExtractionJob, JobStatus } from '@/shared/contracts/job';
import { ExtractionJobContext, ExtractionJobEvent } from '@/types';

/**
 * The single authority on job lifecycle transitions.
 *
 * The background job coordinator rebuilds a machine from the persisted job for
 * every event, applies the event, and writes the resulting state back in the same
 * IndexedDB transaction. An event a state does not allow throws, so an illegal or
 * late transition can never reach storage.
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly currentState: JobStatus,
    public readonly eventType: string
  ) {
    super(`Cannot transition from state '${currentState}' via event '${eventType}'`);
    this.name = 'InvalidStateTransitionError';
  }
}

/** Consecutive batches with no new records before a job is ended automatically. */
export const EMPTY_STEP_CIRCUIT_BREAKER = 3;

type EventType = ExtractionJobEvent['type'];

const TRANSITIONS: Record<JobStatus, Partial<Record<EventType, JobStatus>>> = {
  CREATED: {
    START_EXTRACTION: 'RUNNING',
    CANCEL: 'CANCELLED',
    FAIL: 'FAILED',
  },
  RUNNING: {
    RECORDS_EXTRACTED: 'RUNNING',
    START_PAGINATION: 'RUNNING',
    PAGINATION_COMPLETE: 'RUNNING',
    PAUSE: 'PAUSED',
    FINISH: 'COMPLETED',
    CANCEL: 'CANCELLED',
    FAIL: 'FAILED',
    INTERRUPT: 'INTERRUPTED',
  },
  PAUSED: {
    // A batch already in flight when the user paused is still committed.
    RECORDS_EXTRACTED: 'PAUSED',
    START_PAGINATION: 'PAUSED',
    PAGINATION_COMPLETE: 'PAUSED',
    RESUME: 'RUNNING',
    FINISH: 'COMPLETED',
    CANCEL: 'CANCELLED',
    FAIL: 'FAILED',
    INTERRUPT: 'INTERRUPTED',
  },
  INTERRUPTED: {
    MARK_RECOVERABLE: 'RECOVERABLE',
    CANCEL: 'CANCELLED',
    FAIL: 'FAILED',
  },
  RECOVERABLE: {
    RECOVER: 'RUNNING',
    CANCEL: 'CANCELLED',
    FAIL: 'FAILED',
    EXPIRE: 'EXPIRED',
  },
  COMPLETED: {},
  CANCELLED: {},
  FAILED: {},
  EXPIRED: {},
};

export function canTransition(state: JobStatus, eventType: EventType): boolean {
  return TRANSITIONS[state][eventType] !== undefined;
}

export class ExtractionStateMachine {
  private context: ExtractionJobContext;
  private listeners: Set<(context: ExtractionJobContext) => void> = new Set();

  constructor(initialContext?: Partial<ExtractionJobContext>) {
    this.context = {
      state: 'CREATED',
      currentPage: 1,
      totalExtracted: 0,
      totalDuplicates: 0,
      targetMaxPages: 10,
      consecutiveEmptySteps: 0,
      awaitingNavigation: false,
      tripped: false,
      ...initialContext,
    };
  }

  /** Rebuilds the machine from a persisted job. */
  public static fromJob(job: ExtractionJob): ExtractionStateMachine {
    return new ExtractionStateMachine({
      state: job.status,
      currentPage: Math.max(1, job.pagesVisited),
      totalExtracted: job.totalExtracted,
      totalDuplicates: job.duplicatesSkipped,
      targetMaxPages: job.targetSteps ?? 1,
      consecutiveEmptySteps: job.consecutiveEmptySteps,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.errorMessage,
      interruptedReason: job.interruptedReason,
    });
  }

  public getContext(): Readonly<ExtractionJobContext> {
    return { ...this.context };
  }

  public getState(): JobStatus {
    return this.context.state;
  }

  public subscribe(listener: (context: ExtractionJobContext) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public transition(event: ExtractionJobEvent): ExtractionJobContext {
    const next = TRANSITIONS[this.context.state][event.type];
    if (next === undefined) {
      throw new InvalidStateTransitionError(this.context.state, event.type);
    }

    this.context.state = next;

    switch (event.type) {
      case 'START_EXTRACTION':
        this.context.currentPage = 1;
        this.context.totalExtracted = 0;
        this.context.totalDuplicates = 0;
        this.context.consecutiveEmptySteps = 0;
        this.context.startedAt = Date.now();
        if (event.totalTargetPages) {
          this.context.targetMaxPages = event.totalTargetPages;
        }
        break;
      case 'RECORDS_EXTRACTED':
        this.applyRecords(event.count, event.duplicates, event.ignoreEmpty === true);
        break;
      case 'START_PAGINATION':
        this.context.currentPage = event.page;
        this.context.awaitingNavigation = true;
        break;
      case 'PAGINATION_COMPLETE':
        this.context.awaitingNavigation = false;
        break;
      case 'FINISH':
      case 'CANCEL':
      case 'EXPIRE':
        this.context.finishedAt = Date.now();
        break;
      case 'FAIL':
        this.context.error = event.error;
        this.context.finishedAt = Date.now();
        break;
      case 'INTERRUPT':
        this.context.interruptedReason = event.reason;
        break;
      case 'RECOVER':
        this.context.consecutiveEmptySteps = 0;
        this.context.interruptedReason = undefined;
        break;
      default:
        break;
    }

    this.notify();
    return this.getContext();
  }

  private applyRecords(count: number, duplicates: number, ignoreEmpty: boolean): void {
    this.context.totalExtracted += count;
    this.context.totalDuplicates += duplicates;

    if (count > 0) {
      this.context.consecutiveEmptySteps = 0;
      return;
    }
    if (ignoreEmpty) {
      return;
    }

    this.context.consecutiveEmptySteps += 1;
    if (this.context.consecutiveEmptySteps >= EMPTY_STEP_CIRCUIT_BREAKER) {
      this.context.state = 'COMPLETED';
      this.context.tripped = true;
      this.context.finishedAt = Date.now();
    }
  }

  private notify(): void {
    const snapshot = this.getContext();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
