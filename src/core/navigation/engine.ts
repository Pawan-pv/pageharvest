import { extractFromDocument } from '@/core/extraction/extractor';
import { ExtractedRecord } from '@/types';
import {
  findNextPageControl,
  findLoadMoreControl,
  isControlDisabled,
  isArbitraryNonPaginationButton,
} from './detector';
import {
  waitForDOMStability,
  waitForNewElements,
} from './stability';
import {
  generateNextPageUrl,
  createUrlPaginationRunner,
  normalizeUrlForDeduplication,
} from './url-paginator';
import { performScrollStep } from './scroller';
import {
  PaginationEngineOptions,
  PaginationEngineResult,
  PaginationEngineSafetyLimits,
  PageExtractionBatch,
  NavigationProgress,
  NavigationStopReason,
  PaginationSessionState,
} from './types';

/**
 * Default safety limit constants.
 */
export const DEFAULT_SAFETY_LIMITS: PaginationEngineSafetyLimits = {
  maxPages: 20,
  maxScrolls: 30,
  delayMs: 500,
  scrollDelayMs: 400,
  consecutiveEmptyLimit: 2,
  consecutiveDuplicateLimit: 2,
  pageTimeoutMs: 8000,
  maxRetries: 2,
  retryBackoffMs: 500,
};

/**
 * Main Multi-Page Extraction Engine.
 * Extracts records across pages/scrolls safely without missing or duplicating records.
 */
export async function runMultiPageExtraction(
  options: PaginationEngineOptions
): Promise<PaginationEngineResult> {
  const {
    strategy,
    containerSelector,
    fields,
    controlSelector,
    urlTemplate,
    startPage = 1,
    scrollDistancePx = 800,
    scrollContainerSelector,
    initialSessionState,
    onProgress,
    onPageExtracted,
    signal,
    manualStepTrigger,
    navigateUrl,
    documentRoot = typeof document !== 'undefined' ? document : (null as unknown as Document),
    // Safety limits overrides
    maxPages = DEFAULT_SAFETY_LIMITS.maxPages,
    maxRecords,
    maxScrolls = DEFAULT_SAFETY_LIMITS.maxScrolls,
    delayMs = DEFAULT_SAFETY_LIMITS.delayMs,
    scrollDelayMs = DEFAULT_SAFETY_LIMITS.scrollDelayMs,
    consecutiveEmptyLimit = DEFAULT_SAFETY_LIMITS.consecutiveEmptyLimit,
    consecutiveDuplicateLimit = DEFAULT_SAFETY_LIMITS.consecutiveDuplicateLimit,
    pageTimeoutMs = DEFAULT_SAFETY_LIMITS.pageTimeoutMs,
    maxRetries = DEFAULT_SAFETY_LIMITS.maxRetries,
    retryBackoffMs = DEFAULT_SAFETY_LIMITS.retryBackoffMs,
  } = options;

  const startTime = Date.now();
  const allRecords: ExtractedRecord[] = [];
  const pages: PageExtractionBatch[] = [];

  // Initialize state (with optional restoration from Service Worker session state)
  const seenHashes = new Set<string>(initialSessionState?.seenHashes || []);
  const initialUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
  const urlRunner = createUrlPaginationRunner({
    startUrl: initialSessionState?.lastUrl || initialUrl,
    maxPages,
  });

  if (initialSessionState?.visitedUrls) {
    for (const vUrl of initialSessionState.visitedUrls) {
      urlRunner.visit(vUrl);
    }
  }

  let currentPage = initialSessionState ? initialSessionState.currentPage + 1 : startPage;
  let totalExtracted = initialSessionState?.totalExtracted || 0;
  let duplicatesSkipped = initialSessionState?.duplicatesSkipped || 0;
  let consecutiveEmptyCount = 0;
  let consecutiveDuplicateCount = 0;
  let scrollsCompleted = 0;
  let stopReason: NavigationStopReason = 'completed';
  let fatalError: string | undefined;

  // Helper to broadcast progress
  const emitProgress = (status: NavigationProgress['status'], reason?: NavigationStopReason, err?: string) => {
    if (!onProgress) return;
    const currentUrl = typeof window !== 'undefined' ? window.location.href : initialUrl;
    onProgress({
      strategy,
      status,
      currentPage,
      maxPagesTarget: maxPages,
      recordsExtracted: totalExtracted,
      recordsInCurrentPage: pages.length > 0 ? pages[pages.length - 1].records.length : 0,
      duplicatesCount: duplicatesSkipped,
      totalParsed: totalExtracted + duplicatesSkipped,
      currentUrl,
      elapsedMs: Date.now() - startTime,
      stopReason: reason,
      errorMessage: err,
      timestamp: Date.now(),
    });
  };

  emitProgress('running');

  // Main Page Iteration Loop
  while (true) {
    // 1. Check Cancellation via AbortSignal
    if (signal?.aborted) {
      stopReason = 'cancelled';
      break;
    }

    // 2. Check strict safety limit: Max Pages
    if (currentPage > maxPages) {
      stopReason = 'max_pages_reached';
      break;
    }

    // 3. Check optional record count ceiling
    if (maxRecords && totalExtracted >= maxRecords) {
      stopReason = 'max_records_reached';
      break;
    }

    // 4. Wait for DOM stability before extracting
    await waitForDOMStability(
      documentRoot instanceof Document ? documentRoot.body : documentRoot,
      { timeoutMs: Math.min(pageTimeoutMs, 3000), quietPeriodMs: 150, pollIntervalMs: 30 }
    );

    // 5. Extract records for the current page
    const currentUrl = typeof window !== 'undefined' ? window.location.href : initialUrl;
    const extractionResult = extractFromDocument(
      containerSelector,
      fields,
      currentPage,
      seenHashes,
      documentRoot
    );

    const newRecords = extractionResult.records;
    const batchDuplicates = extractionResult.duplicatesCount;
    duplicatesSkipped += batchDuplicates;

    // Track empty batches
    if (newRecords.length === 0 && batchDuplicates === 0) {
      consecutiveEmptyCount++;
      if (consecutiveEmptyCount >= consecutiveEmptyLimit) {
        stopReason = 'empty_page_limit';
        break;
      }
    } else {
      consecutiveEmptyCount = 0;
    }

    // Track 100% duplicate batches
    if (newRecords.length === 0 && batchDuplicates > 0) {
      consecutiveDuplicateCount++;
      if (consecutiveDuplicateCount >= consecutiveDuplicateLimit) {
        stopReason = 'duplicate_page_limit';
        break;
      }
    } else {
      consecutiveDuplicateCount = 0;
    }

    // Record the extracted batch
    totalExtracted += newRecords.length;
    allRecords.push(...newRecords);

    const batch: PageExtractionBatch = {
      page: currentPage,
      records: newRecords,
      newRecordsCount: newRecords.length,
      duplicatesCount: batchDuplicates,
      url: currentUrl,
      timestamp: Date.now(),
    };
    pages.push(batch);

    if (onPageExtracted) {
      onPageExtracted(batch);
    }

    emitProgress('running');

    // If maxRecords reached during this batch, halt
    if (maxRecords && totalExtracted >= maxRecords) {
      stopReason = 'max_records_reached';
      break;
    }

    // If we have completed the requested maxPages on this page, halt
    if (currentPage >= maxPages) {
      stopReason = 'max_pages_reached';
      break;
    }

    // 6. Navigation to Next Page based on strategy
    let navigationSucceeded = false;

    // A. Manual strategy: Wait for user confirmation
    if (strategy === 'manual') {
      if (manualStepTrigger) {
        const shouldProceed = await manualStepTrigger();
        if (shouldProceed) {
          currentPage++;
          navigationSucceeded = true;
          continue;
        } else {
          stopReason = 'manual_stop';
          break;
        }
      } else {
        stopReason = 'manual_stop';
        break;
      }
    }

    // B. Infinite Scroll strategy
    if (strategy === 'infinite_scroll') {
      if (scrollsCompleted >= maxScrolls) {
        stopReason = 'max_scrolls_reached';
        break;
      }

      const initialCount = documentRoot.querySelectorAll(containerSelector).length;
      const scrollResult = performScrollStep({
        distancePx: scrollDistancePx,
        containerSelector: scrollContainerSelector,
      });

      scrollsCompleted++;

      if (scrollDelayMs > 0) {
        await new Promise((res) => setTimeout(res, scrollDelayMs));
      }

      // Wait for dynamic items to be appended or DOM stability
      await waitForNewElements(
        containerSelector,
        initialCount,
        { timeoutMs: Math.min(pageTimeoutMs, 2000), minNewCount: 1, pollIntervalMs: 50 },
        documentRoot
      );

      currentPage++;
      navigationSucceeded = true;
      continue;
    }

    // C. Next Link or Load More strategy
    if (strategy === 'next_link' || strategy === 'load_more') {
      // Find the appropriate control
      const control = strategy === 'load_more'
        ? findLoadMoreControl(documentRoot, controlSelector)
        : findNextPageControl(documentRoot, controlSelector);

      if (!control) {
        stopReason = 'control_disabled_or_missing';
        break;
      }

      if (control.isDisabled) {
        stopReason = 'control_disabled_or_missing';
        break;
      }

      // Safeguard: Never click arbitrary non-pagination action buttons
      if (isArbitraryNonPaginationButton(control.element)) {
        stopReason = 'control_disabled_or_missing';
        break;
      }

      // Check loop prevention if anchor with target URL
      if (control.isAnchor && control.href) {
        const nextUrlNormalized = normalizeUrlForDeduplication(control.href);
        const currentUrlNormalized = normalizeUrlForDeduplication(currentUrl);

        if (nextUrlNormalized === currentUrlNormalized || urlRunner.hasVisited(control.href)) {
          stopReason = 'repeated_url';
          break;
        }
      }

      // Attempt navigation with retries
      let retryCount = 0;
      let actionSuccess = false;

      while (retryCount <= maxRetries && !actionSuccess) {
        if (signal?.aborted) {
          stopReason = 'cancelled';
          break;
        }

        try {
          const initialContainerCount = documentRoot.querySelectorAll(containerSelector).length;

          // If custom URL navigator is provided and control is an anchor
          if (control.isAnchor && control.href && navigateUrl) {
            const accepted = urlRunner.visit(control.href);
            if (!accepted) {
              stopReason = 'repeated_url';
              break;
            }
            actionSuccess = await navigateUrl(control.href);
          } else {
            // Click the element
            if (typeof (control.element as HTMLElement).click === 'function') {
              (control.element as HTMLElement).click();
            } else {
              const clickEvent = new Event('click', { bubbles: true, cancelable: true });
              control.element.dispatchEvent(clickEvent);
            }
            actionSuccess = true;
          }

          if (strategy === 'load_more') {
            // Wait for new items to appear in container
            await waitForNewElements(
              containerSelector,
              initialContainerCount,
              { timeoutMs: Math.min(pageTimeoutMs, 3000), minNewCount: 1, pollIntervalMs: 50 },
              documentRoot
            );
          } else {
            // Wait for DOM stability
            await waitForDOMStability(
              documentRoot instanceof Document ? documentRoot.body : documentRoot,
              { timeoutMs: Math.min(pageTimeoutMs, 3000), quietPeriodMs: 150 }
            );
          }

          if (delayMs > 0) {
            await new Promise((res) => setTimeout(res, delayMs));
          }
        } catch (err: unknown) {
          retryCount++;
          if (retryCount <= maxRetries) {
            await new Promise((res) => setTimeout(res, retryBackoffMs * retryCount));
          } else {
            fatalError = err instanceof Error ? err.message : String(err);
            stopReason = 'navigation_failure';
            break;
          }
        }
      }

      if (stopReason === 'repeated_url' || stopReason === 'cancelled' || stopReason === 'navigation_failure') {
        break;
      }

      if (actionSuccess) {
        currentPage++;
        navigationSucceeded = true;
        continue;
      } else {
        stopReason = 'navigation_failure';
        break;
      }
    }

    // D. URL Pagination strategy
    if (strategy === 'url_pagination') {
      const nextPage = currentPage + 1;
      const targetUrl = generateNextPageUrl(currentUrl, {
        currentPage,
        nextPage,
        template: urlTemplate,
      });

      // Loop detection
      const accepted = urlRunner.visit(targetUrl);
      if (!accepted) {
        stopReason = 'repeated_url';
        break;
      }

      if (navigateUrl) {
        try {
          const navOk = await navigateUrl(targetUrl);
          if (!navOk) {
            stopReason = 'navigation_failure';
            break;
          }
        } catch (err: unknown) {
          fatalError = err instanceof Error ? err.message : String(err);
          stopReason = 'navigation_failure';
          break;
        }
      }

      if (delayMs > 0) {
        await new Promise((res) => setTimeout(res, delayMs));
      }

      currentPage++;
      navigationSucceeded = true;
      continue;
    }

    // If no navigation strategy succeeded, break
    if (!navigationSucceeded) {
      break;
    }
  }

  const durationMs = Date.now() - startTime;
  const isFinalSuccess = stopReason !== 'navigation_failure';

  emitProgress(isFinalSuccess ? 'completed' : 'failed', stopReason, fatalError);

  // Generate resumable state for Service Worker persistence
  const resumableState: PaginationSessionState = {
    strategy,
    currentPage,
    totalExtracted,
    duplicatesSkipped,
    seenHashes: Array.from(seenHashes),
    visitedUrls: urlRunner.getVisitedUrls(),
    lastUrl: typeof window !== 'undefined' ? window.location.href : initialUrl,
    savedAt: Date.now(),
  };

  return {
    success: isFinalSuccess,
    strategy,
    totalPages: pages.length,
    totalRecords: allRecords.length,
    duplicatesSkipped,
    records: allRecords,
    pages,
    stopReason,
    error: fatalError,
    durationMs,
    resumableState,
  };
}
