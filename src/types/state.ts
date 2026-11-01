export type ExtractionJobState =
  | 'IDLE'
  | 'INSPECTING'
  | 'EXTRACTING'
  | 'PAGINATING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'ERROR';

export type ExtractionJobEvent =
  | { type: 'START_INSPECTION' }
  | { type: 'CANCEL_INSPECTION' }
  | { type: 'START_EXTRACTION'; totalTargetPages?: number }
  | { type: 'RECORDS_EXTRACTED'; count: number; duplicates: number }
  | { type: 'START_PAGINATION'; page: number }
  | { type: 'PAGINATION_COMPLETE' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'FINISH' }
  | { type: 'ABORT' }
  | { type: 'FAIL'; error: string };

export interface ExtractionJobContext {
  state: ExtractionJobState;
  currentPage: number;
  totalExtracted: number;
  totalDuplicates: number;
  targetMaxPages: number;
  consecutiveEmptySteps: number;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}
