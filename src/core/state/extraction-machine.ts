import {
  ExtractionJobState,
  ExtractionJobEvent,
  ExtractionJobContext
} from '@/types';

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly currentState: ExtractionJobState,
    public readonly eventType: string
  ) {
    super(`Cannot transition from state '${currentState}' via event '${eventType}'`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class ExtractionStateMachine {
  private context: ExtractionJobContext;
  private listeners: Set<(context: ExtractionJobContext) => void> = new Set();

  constructor(initialContext?: Partial<ExtractionJobContext>) {
    this.context = {
      state: 'IDLE',
      currentPage: 1,
      totalExtracted: 0,
      totalDuplicates: 0,
      targetMaxPages: 10,
      consecutiveEmptySteps: 0,
      ...initialContext
    };
  }

  public getContext(): Readonly<ExtractionJobContext> {
    return { ...this.context };
  }

  public getState(): ExtractionJobState {
    return this.context.state;
  }

  public subscribe(listener: (context: ExtractionJobContext) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const ctx = this.getContext();
    this.listeners.forEach((l) => l(ctx));
  }

  public transition(event: ExtractionJobEvent): ExtractionJobContext {
    const current = this.context.state;

    switch (current) {
      case 'IDLE':
        if (event.type === 'START_INSPECTION') {
          this.context.state = 'INSPECTING';
        } else if (event.type === 'START_EXTRACTION') {
          this.context.state = 'EXTRACTING';
          this.context.currentPage = 1;
          this.context.totalExtracted = 0;
          this.context.totalDuplicates = 0;
          this.context.consecutiveEmptySteps = 0;
          this.context.startedAt = Date.now();
          if (event.totalTargetPages) {
            this.context.targetMaxPages = event.totalTargetPages;
          }
        } else {
          throw new InvalidStateTransitionError(current, event.type);
        }
        break;

      case 'INSPECTING':
        if (event.type === 'CANCEL_INSPECTION') {
          this.context.state = 'IDLE';
        } else if (event.type === 'START_EXTRACTION') {
          this.context.state = 'EXTRACTING';
          this.context.currentPage = 1;
          this.context.totalExtracted = 0;
          this.context.totalDuplicates = 0;
          this.context.consecutiveEmptySteps = 0;
          this.context.startedAt = Date.now();
          if (event.totalTargetPages) {
            this.context.targetMaxPages = event.totalTargetPages;
          }
        } else {
          throw new InvalidStateTransitionError(current, event.type);
        }
        break;

      case 'EXTRACTING':
        if (event.type === 'RECORDS_EXTRACTED') {
          this.context.totalExtracted += event.count;
          this.context.totalDuplicates += event.duplicates;

          if (event.count === 0) {
            this.context.consecutiveEmptySteps++;
            // Circuit breaker: 3 consecutive empty extraction steps
            if (this.context.consecutiveEmptySteps >= 3) {
              this.context.state = 'COMPLETED';
              this.context.finishedAt = Date.now();
              this.notify();
              return this.getContext();
            }
          } else {
            this.context.consecutiveEmptySteps = 0;
          }
        } else if (event.type === 'START_PAGINATION') {
          this.context.state = 'PAGINATING';
          this.context.currentPage = event.page;
        } else if (event.type === 'PAUSE') {
          this.context.state = 'PAUSED';
        } else if (event.type === 'FINISH') {
          this.context.state = 'COMPLETED';
          this.context.finishedAt = Date.now();
        } else if (event.type === 'ABORT') {
          this.context.state = 'COMPLETED';
          this.context.finishedAt = Date.now();
        } else if (event.type === 'FAIL') {
          this.context.state = 'ERROR';
          this.context.error = event.error;
          this.context.finishedAt = Date.now();
        } else {
          throw new InvalidStateTransitionError(current, event.type);
        }
        break;

      case 'PAGINATING':
        if (event.type === 'PAGINATION_COMPLETE') {
          this.context.state = 'EXTRACTING';
        } else if (event.type === 'PAUSE') {
          this.context.state = 'PAUSED';
        } else if (event.type === 'FINISH' || event.type === 'ABORT') {
          this.context.state = 'COMPLETED';
          this.context.finishedAt = Date.now();
        } else if (event.type === 'FAIL') {
          this.context.state = 'ERROR';
          this.context.error = event.error;
          this.context.finishedAt = Date.now();
        } else {
          throw new InvalidStateTransitionError(current, event.type);
        }
        break;

      case 'PAUSED':
        if (event.type === 'RESUME') {
          this.context.state = 'EXTRACTING';
        } else if (event.type === 'ABORT' || event.type === 'FINISH') {
          this.context.state = 'COMPLETED';
          this.context.finishedAt = Date.now();
        } else if (event.type === 'FAIL') {
          this.context.state = 'ERROR';
          this.context.error = event.error;
          this.context.finishedAt = Date.now();
        } else {
          throw new InvalidStateTransitionError(current, event.type);
        }
        break;

      case 'COMPLETED':
      case 'ERROR':
        if (event.type === 'START_EXTRACTION') {
          this.context.state = 'EXTRACTING';
          this.context.currentPage = 1;
          this.context.totalExtracted = 0;
          this.context.totalDuplicates = 0;
          this.context.consecutiveEmptySteps = 0;
          this.context.error = undefined;
          this.context.startedAt = Date.now();
          this.context.finishedAt = undefined;
          if (event.totalTargetPages) {
            this.context.targetMaxPages = event.totalTargetPages;
          }
        } else if (event.type === 'START_INSPECTION') {
          this.context.state = 'INSPECTING';
          this.context.error = undefined;
        } else {
          throw new InvalidStateTransitionError(current, event.type);
        }
        break;

      default:
        throw new Error(`Unhandled state: ${current}`);
    }

    this.notify();
    return this.getContext();
  }
}
