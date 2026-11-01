import { extractRecordsFromContainers } from '@/core/extraction/extractor';
import { ExtractedRecord } from '@/types';
import {
  findNextPageControl,
  findLoadMoreControl,
  isArbitraryNonPaginationButton,
} from './detector';
import {
  waitForDOMStability,
  waitForNewElements,
  waitForUrlChange,
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

/** A delay that ends early when the job is cancelled. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * True when clicking this anchor loads another document. "#" and "javascript:" links
 * are in-page controls that happen to be anchors.
 */
function isDocumentLink(element: Element, href: string | undefined): href is string {
  if (!href) return false;
  const raw = (element.getAttribute('href') ?? '').trim().toLowerCase();
  return raw !== '' && !raw.startsWith('#') && !raw.startsWith('javascript:');
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

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
    beforeNavigate,
    waitWhilePaused,
    allowedOrigin,
    getCurrentUrl,
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
    navigationTimeoutMs = Math.min(pageTimeoutMs, 5000),
  } = options;

  const startTime = Date.now();
  const allRecords: ExtractedRecord[] = [];
  const pages: PageExtractionBatch[] = [];

  // Initialize state (with optional restoration from a durable checkpoint)
  const seenSignatures = new Set<string>(initialSessionState?.seenHashes || []);
  const readUrl = getCurrentUrl ?? (() => (typeof window !== 'undefined' ? window.location.href : 'http://localhost'));
  const initialUrl = readUrl();
  const urlRunner = createUrlPaginationRunner({
    startUrl: initialSessionState?.lastUrl || initialUrl,
    maxPages,
  });

  if (initialSessionState?.visitedUrls) {
    for (const vUrl of initialSessionState.visitedUrls) {
      urlRunner.visit(vUrl);
    }
  }

  // Lists that keep earlier items on the page must not re-report them on every step.
  const elementMemory =
    strategy === 'infinite_scroll' || strategy === 'load_more'
      ? new WeakMap<Element, string>()
      : undefined;

  let currentPage = initialSessionState ? initialSessionState.currentPage + 1 : startPage;
  let totalExtracted = initialSessionState?.totalExtracted || 0;
  let duplicatesSkipped = initialSessionState?.duplicatesSkipped || 0;
  let consecutiveEmptyCount = 0;
  let consecutiveDuplicateCount = 0;
  let scrollsCompleted = initialSessionState?.scrollsCompleted || 0;
  const catchUpScrolls = initialSessionState?.catchUpScrolls || 0;
  let stopReason: NavigationStopReason = 'completed';
  let fatalError: string | undefined;

  // Helper to broadcast progress
  const emitProgress = (status: NavigationProgress['status'], reason?: NavigationStopReason, err?: string) => {
    if (!onProgress) return;
    const currentUrl = readUrl();
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
    // 1. Hold here while the job is paused, then check for cancellation
    await waitWhilePaused?.();
    if (signal?.aborted) {
      stopReason = 'cancelled';
      break;
    }

    // 2. Page limit. Scrolling is limited by maxScrolls, never by maxPages.
    if (strategy !== 'infinite_scroll' && currentPage > maxPages) {
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
    const currentUrl = readUrl();
    urlRunner.visit(currentUrl);
    let containers: Element[];
    try {
      containers = Array.from(documentRoot.querySelectorAll(containerSelector));
    } catch {
      containers = [];
    }

    const extractionResult = extractRecordsFromContainers(
      containers,
      fields,
      currentPage,
      seenSignatures,
      currentUrl,
      elementMemory
    );

    const newRecords = extractionResult.records;
    const batchDuplicates = extractionResult.duplicatesCount;
    const isCatchUp = strategy === 'infinite_scroll' && scrollsCompleted < catchUpScrolls;
    duplicatesSkipped += batchDuplicates;
    totalExtracted += newRecords.length;
    allRecords.push(...newRecords);

    const batch: PageExtractionBatch = {
      page: currentPage,
      records: newRecords,
      newRecordsCount: newRecords.length,
      duplicatesCount: batchDuplicates,
      detectedCount: extractionResult.totalParsed,
      missingFieldCount: extractionResult.missingFieldCount,
      filteredCount: extractionResult.filteredCount,
      failedCount: extractionResult.failedCount,
      scrollsCompleted,
      isCatchUp,
      url: currentUrl,
      timestamp: Date.now(),
    };
    pages.push(batch);

    // 6. Commit before anything else happens. The next action may unload this document.
    const commit = await onPageExtracted?.(batch);
    emitProgress('running');

    if (commit && commit.stop) {
      stopReason = 'stopped_by_coordinator';
      break;
    }

    // 7. Stop conditions based on what this step produced. A resumed scroll job is
    //    expected to see only known rows until it reaches where it was interrupted.
    if (!isCatchUp) {
      if (newRecords.length === 0 && batchDuplicates === 0) {
        consecutiveEmptyCount++;
        if (consecutiveEmptyCount >= consecutiveEmptyLimit) {
          stopReason = 'empty_page_limit';
          break;
        }
      } else {
        consecutiveEmptyCount = 0;
      }

      if (newRecords.length === 0 && batchDuplicates > 0) {
        consecutiveDuplicateCount++;
        if (consecutiveDuplicateCount >= consecutiveDuplicateLimit) {
          stopReason = 'duplicate_page_limit';
          break;
        }
      } else {
        consecutiveDuplicateCount = 0;
      }
    }

    // If maxRecords reached during this batch, halt
    if (maxRecords && totalExtracted >= maxRecords) {
      stopReason = 'max_records_reached';
      break;
    }

    // Check if pagination controls exist and are enabled
    if (strategy === 'next_link') {
      const nextControl = findNextPageControl(documentRoot, controlSelector);
      if (!nextControl || nextControl.isDisabled) {
        stopReason = 'control_disabled_or_missing';
        break;
      }
    } else if (strategy === 'load_more') {
      const loadMoreControl = findLoadMoreControl(documentRoot, controlSelector);
      if (!loadMoreControl || loadMoreControl.isDisabled) {
        stopReason = 'control_disabled_or_missing';
        break;
      }
    }

    // If we have completed the requested maxPages on this page, halt
    if (strategy !== 'infinite_scroll' && currentPage >= maxPages) {
      stopReason = 'max_pages_reached';
      break;
    }

    // A pause requested during the commit takes effect before the next action.
    await waitWhilePaused?.();
    if (signal?.aborted) {
      stopReason = 'cancelled';
      break;
    }

    // 8. Navigation to Next Page based on strategy
    // A. Manual strategy: Wait for user confirmation
    if (strategy === 'manual') {
      if (manualStepTrigger) {
        const shouldProceed = await manualStepTrigger();
        if (shouldProceed) {
          currentPage++;
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
      performScrollStep({
        distancePx: scrollDistancePx,
        containerSelector: scrollContainerSelector,
      });

      scrollsCompleted++;

      if (scrollDelayMs > 0) {
        await sleep(scrollDelayMs, signal);
      }
      if (signal?.aborted) {
        stopReason = 'cancelled';
        break;
      }

      // Wait for dynamic items to be appended or DOM stability
      await waitForNewElements(
        containerSelector,
        initialCount,
        { timeoutMs: Math.min(pageTimeoutMs, 2000), minNewCount: 1, pollIntervalMs: 50 },
        documentRoot
      );

      currentPage++;
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

      const documentLink = isDocumentLink(control.element, control.href) ? control.href : undefined;

      if (documentLink) {
        // Never follow a pagination link off the site the job started on.
        if (allowedOrigin && originOf(documentLink) !== allowedOrigin) {
          stopReason = 'cross_origin_blocked';
          break;
        }

        // Check loop prevention if anchor with target URL
        const nextUrlNormalized = normalizeUrlForDeduplication(documentLink);
        const currentUrlNormalized = normalizeUrlForDeduplication(currentUrl);

        if (nextUrlNormalized === currentUrlNormalized || urlRunner.hasVisited(documentLink)) {
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

          // The checkpoint must be durable before the click: this document may not survive it.
          await beforeNavigate?.({ href: documentLink, page: currentPage + 1 });

          // If custom URL navigator is provided and control is an anchor
          if (documentLink && navigateUrl) {
            const accepted = urlRunner.visit(documentLink);
            if (!accepted) {
              stopReason = 'repeated_url';
              break;
            }
            actionSuccess = await navigateUrl(documentLink);
          } else {
            const locationBeforeClick = currentUrl;
            // Click the element
            if (typeof (control.element as HTMLElement).click === 'function') {
              (control.element as HTMLElement).click();
            } else {
              const clickEvent = new Event('click', { bubbles: true, cancelable: true });
              control.element.dispatchEvent(clickEvent);
            }
            actionSuccess = true;

            // In a real navigation this document is destroyed during the wait and nothing
            // after it runs; the job continues from the checkpoint in the next document.
            // If the location changes and the document survives it is a client-side route,
            // and if nothing changes the click was handled in place. Either way, carry on.
            if (documentLink) {
              await waitForUrlChange(locationBeforeClick, navigationTimeoutMs, 50, {
                signal,
                getCurrentUrl: readUrl,
              });
            }
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
            await sleep(delayMs, signal);
          }
        } catch (err: unknown) {
          retryCount++;
          if (retryCount <= maxRetries) {
            await sleep(retryBackoffMs * retryCount, signal);
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

      if (signal?.aborted) {
        stopReason = 'cancelled';
        break;
      }

      if (actionSuccess) {
        currentPage++;
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
        await sleep(delayMs, signal);
      }

      currentPage++;
      continue;
    }
  }

  const durationMs = Date.now() - startTime;
  const isFinalSuccess = stopReason !== 'navigation_failure';

  emitProgress(isFinalSuccess ? 'completed' : 'failed', stopReason, fatalError);

  // Generate resumable state for durable persistence
  const resumableState: PaginationSessionState = {
    strategy,
    currentPage,
    totalExtracted,
    duplicatesSkipped,
    seenHashes: Array.from(seenSignatures),
    visitedUrls: urlRunner.getVisitedUrls(),
    lastUrl: readUrl(),
    savedAt: Date.now(),
    scrollsCompleted,
    catchUpScrolls,
  };

  const priorPages = initialSessionState ? initialSessionState.currentPage : 0;
  const priorRecords = initialSessionState ? initialSessionState.totalExtracted : 0;

  return {
    success: isFinalSuccess,
    strategy,
    totalPages: priorPages + pages.length,
    totalRecords: priorRecords + allRecords.length,
    duplicatesSkipped,
    records: allRecords,
    pages,
    stopReason,
    error: fatalError,
    durationMs,
    resumableState,
  };
}
