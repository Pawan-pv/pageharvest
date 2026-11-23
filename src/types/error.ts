import type { ExtractionErrorCode } from '@/shared/contracts/error';

export type ErrorCategory =
  | 'DOM_PARSING'
  | 'SELECTOR_NOT_FOUND'
  | 'PAGINATION_FAILED'
  | 'STORAGE_FAILED'
  | 'RUNTIME_MESSAGING'
  | 'VALIDATION_FAILED'
  | 'CIRCUIT_BREAKER_TRIGGERED'
  | 'UNKNOWN';

export type ErrorSeverity = 'WARN' | 'ERROR' | 'FATAL';

export interface HarvestError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  /** What the panel tells the user; see ADR-031. */
  code?: ExtractionErrorCode;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
  stack?: string;
}
