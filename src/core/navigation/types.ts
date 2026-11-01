import { FieldDefinition, ExtractedRecord } from '@/types';

/**
 * Supported navigation strategies for multi-page extraction.
 */
export type NavigationStrategy =
  | 'next_link'
  | 'load_more'
  | 'url_pagination'
  | 'infinite_scroll'
  | 'manual';

/**
 * An identified pagination control candidate in the DOM.
 */
export interface PaginationControl {
  element: Element;
  strategy: NavigationStrategy;
  confidence: number; // 0 to 1 score
  selector: string;
  isAnchor: boolean;
  href?: string;
  text: string;
  isDisabled: boolean;
}

/**
 * Result of automated pagination detection.
 */
export interface PaginationDetectorResult {
  recommendedStrategy: NavigationStrategy;
  controls: PaginationControl[];
  urlPattern?: {
    template: string;
    paramName?: string;
    currentPage: number;
    nextPage: number;
  };
  scrollableContainerSelector?: string;
}

/**
 * Options for waiting on DOM stability.
 */
export interface DOMStabilityOptions {
  timeoutMs?: number;      // Maximum time to wait (default: 5000)
  quietPeriodMs?: number;  // Required mutation-free quiet window (default: 250)
  pollIntervalMs?: number; // Check interval (default: 50)
}

/**
 * Options for waiting for new container elements to appear (e.g. after Load More or scroll).
 */
export interface WaitForNewElementsOptions {
  timeoutMs?: number;      // Maximum wait time (default: 5000)
  minNewCount?: number;    // Minimum new elements required (default: 1)
  pollIntervalMs?: number; // Polling check interval (default: 50)
}

/**
 * User-configurable and default safety limits.
 */
export interface PaginationEngineSafetyLimits {
  maxPages: number;                  // Max page limit (default: 20)
  maxRecords?: number;               // Max records limit (optional cap)
  maxScrolls: number;                // Max scroll attempts (default: 30)
  delayMs: number;                   // Delay between pages/actions in ms (default: 500)
  scrollDelayMs: number;             // Delay after scroll step in ms (default: 400)
  consecutiveEmptyLimit: number;     // Halt after N empty batches (default: 2)
  consecutiveDuplicateLimit: number; // Halt after N 100% duplicate batches (default: 2)
  pageTimeoutMs: number;             // Timeout waiting for page stability (default: 8000)
  maxRetries: number;                // Retries on transient failure (default: 2)
  retryBackoffMs: number;            // Retry base backoff ms (default: 500)
}

/**
 * Batch of records extracted from a single page step.
 */
export interface PageExtractionBatch {
  page: number;
  records: ExtractedRecord[];
  newRecordsCount: number;
  duplicatesCount: number;
  url: string;
  timestamp: number;
}

/**
 * Reason the multi-page engine halted.
 */
export type NavigationStopReason =
  | 'max_pages_reached'
  | 'max_records_reached'
  | 'max_scrolls_reached'
  | 'control_disabled_or_missing'
  | 'empty_page_limit'
  | 'duplicate_page_limit'
  | 'repeated_url'
  | 'cancelled'
  | 'navigation_failure'
  | 'manual_stop'
  | 'completed';

/**
 * Progress broadcast during extraction.
 */
export interface NavigationProgress {
  jobId?: string;
  strategy: NavigationStrategy;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'paused';
  currentPage: number;
  maxPagesTarget?: number;
  recordsExtracted: number;
  recordsInCurrentPage: number;
  duplicatesCount: number;
  totalParsed: number;
  currentUrl: string;
  elapsedMs: number;
  stopReason?: NavigationStopReason;
  errorMessage?: string;
  timestamp: number;
}

/**
 * Persisted state to resume an extraction job across Service Worker restarts.
 */
export interface PaginationSessionState {
  jobId?: string;
  strategy: NavigationStrategy;
  currentPage: number;
  totalExtracted: number;
  duplicatesSkipped: number;
  seenHashes: string[];
  visitedUrls: string[];
  lastUrl: string;
  savedAt: number;
}

/**
 * Full configuration for executing a multi-page extraction engine run.
 */
export interface PaginationEngineOptions extends Partial<PaginationEngineSafetyLimits> {
  strategy: NavigationStrategy;
  containerSelector: string;
  fields: FieldDefinition[];
  controlSelector?: string;
  urlTemplate?: string;
  startPage?: number;
  scrollDistancePx?: number;
  scrollContainerSelector?: string;
  initialSessionState?: PaginationSessionState;
  onProgress?: (progress: NavigationProgress) => void;
  onPageExtracted?: (batch: PageExtractionBatch) => void;
  signal?: AbortSignal;
  manualStepTrigger?: () => Promise<boolean>;
  navigateUrl?: (targetUrl: string) => Promise<boolean>;
  documentRoot?: Document | Element;
}

/**
 * Final execution report returned by the engine.
 */
export interface PaginationEngineResult {
  success: boolean;
  strategy: NavigationStrategy;
  totalPages: number;
  totalRecords: number;
  duplicatesSkipped: number;
  records: ExtractedRecord[];
  pages: PageExtractionBatch[];
  stopReason: NavigationStopReason;
  error?: string;
  durationMs: number;
  resumableState?: PaginationSessionState;
}
