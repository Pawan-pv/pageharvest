import { JobStatus } from '@/shared/contracts/job';

export type ExtractionJobState = JobStatus;

export type ExtractionJobEvent =
  | { type: 'START_EXTRACTION'; totalTargetPages?: number }
  | { type: 'RECORDS_EXTRACTED'; count: number; duplicates: number; ignoreEmpty?: boolean }
  | { type: 'START_PAGINATION'; page: number }
  | { type: 'PAGINATION_COMPLETE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'FINISH' }
  | { type: 'CANCEL' }
  | { type: 'FAIL'; error: string }
  | { type: 'INTERRUPT'; reason: string }
  | { type: 'MARK_RECOVERABLE' }
  | { type: 'RECOVER' }
  | { type: 'EXPIRE' };

export interface ExtractionJobContext {
  state: ExtractionJobState;
  currentPage: number;
  totalExtracted: number;
  totalDuplicates: number;
  targetMaxPages: number;
  consecutiveEmptySteps: number;
  awaitingNavigation: boolean;
  /** True when the empty-batch circuit breaker ended the job. */
  tripped: boolean;
  error?: string;
  interruptedReason?: string;
  startedAt?: number;
  finishedAt?: number;
}
