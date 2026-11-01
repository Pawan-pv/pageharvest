import { DOMStabilityOptions, WaitForNewElementsOptions } from './types';

/**
 * General-purpose asynchronous condition poller with timeout and AbortSignal support.
 */
export async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    errorMessage?: string;
  } = {}
): Promise<boolean> {
  const {
    timeoutMs = 5000,
    pollIntervalMs = 50,
    signal,
    errorMessage = 'Condition timed out',
  } = options;

  if (signal?.aborted) {
    throw new Error('Aborted');
  }

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    const matched = await predicate();
    if (matched) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`${errorMessage} after ${timeoutMs}ms`);
}

/**
 * Monitors DOM mutations on a target container or document root.
 * Declares DOM stable once no mutations have occurred for `quietPeriodMs`.
 */
export function waitForDOMStability(
  target: Node = document.body || document.documentElement,
  options: DOMStabilityOptions = {}
): Promise<boolean> {
  const {
    timeoutMs = 5000,
    quietPeriodMs = 250,
    pollIntervalMs = 50,
  } = options;

  return new Promise((resolve) => {
    let lastMutationTime = Date.now();
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let maxTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (maxTimeoutTimer) {
        clearTimeout(maxTimeoutTimer);
        maxTimeoutTimer = null;
      }
    };

    if (typeof MutationObserver !== 'undefined' && target) {
      observer = new MutationObserver(() => {
        lastMutationTime = Date.now();
      });

      try {
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      } catch {
        // Fallback if target cannot be observed
      }
    }

    timer = setInterval(() => {
      const timeSinceLastMutation = Date.now() - lastMutationTime;
      if (timeSinceLastMutation >= quietPeriodMs) {
        cleanup();
        resolve(true);
      }
    }, pollIntervalMs);

    maxTimeoutTimer = setTimeout(() => {
      cleanup();
      // Even if timed out waiting for complete silence, proceed so execution doesn't hang
      resolve(true);
    }, timeoutMs);
  });
}

/**
 * Waits until the number of elements matching `containerSelector` increases above `initialCount`.
 * Essential for dynamic "Load More" and infinite scrolling feeds.
 */
export async function waitForNewElements(
  containerSelector: string,
  initialCount: number,
  options: WaitForNewElementsOptions = {},
  root: Document | Element = document
): Promise<{ success: boolean; newCount: number; diff: number; timedOut: boolean }> {
  const {
    timeoutMs = 5000,
    minNewCount = 1,
    pollIntervalMs = 50,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    let currentCount = 0;
    try {
      currentCount = root.querySelectorAll(containerSelector).length;
    } catch {
      currentCount = 0;
    }

    const diff = currentCount - initialCount;
    if (diff >= minNewCount) {
      return {
        success: true,
        newCount: currentCount,
        diff,
        timedOut: false,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  let finalCount = 0;
  try {
    finalCount = root.querySelectorAll(containerSelector).length;
  } catch {
    finalCount = initialCount;
  }

  return {
    success: finalCount - initialCount >= minNewCount,
    newCount: finalCount,
    diff: finalCount - initialCount,
    timedOut: true,
  };
}

/**
 * Waits for a URL change compared to initialUrl.
 */
export async function waitForUrlChange(
  initialUrl: string,
  timeoutMs: number = 5000,
  pollIntervalMs: number = 50
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    if (currentUrl && currentUrl !== initialUrl) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return false;
}
