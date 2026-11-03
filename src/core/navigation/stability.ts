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
    minWaitMs = 0,
  } = options;

  const initStartTime = Date.now();

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
      const now = Date.now();
      const totalElapsed = now - initStartTime;
      if (totalElapsed < minWaitMs) {
        return;
      }
      const timeSinceLastMutation = now - lastMutationTime;
      if (timeSinceLastMutation >= quietPeriodMs && totalElapsed >= (minWaitMs + (lastMutationTime > initStartTime ? quietPeriodMs : 0))) {
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
    const currentCount = (() => {
      try {
        return root.querySelectorAll(containerSelector).length;
      } catch {
        return 0;
      }
    })();

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

  const finalCount = (() => {
    try {
      return root.querySelectorAll(containerSelector).length;
    } catch {
      return initialCount;
    }
  })();

  return {
    success: finalCount - initialCount >= minNewCount,
    newCount: finalCount,
    diff: finalCount - initialCount,
    timedOut: true,
  };
}

/**
 * Waits for either new matching containers or a mutation inside an existing one.
 * Infinite-scroll feeds can populate values such as lazy images without adding a
 * container, so waiting only for the selector count would unnecessarily consume
 * the whole timeout on every scroll.
 */
export function waitForNewElementsOrMutation(
  containerSelector: string,
  initialCount: number,
  options: WaitForNewElementsOptions = {},
  root: Document | Element = document
): Promise<{ success: boolean; newCount: number; diff: number; mutated: boolean; timedOut: boolean }> {
  const {
    timeoutMs = 5000,
    minNewCount = 1,
    pollIntervalMs = 50,
  } = options;

  const readMatches = (): Element[] => {
    try {
      return Array.from(root.querySelectorAll(containerSelector));
    } catch {
      return [];
    }
  };

  const mutationTouchesMatch = (mutation: MutationRecord, matches: Element[]): boolean => {
    const target = mutation.target;
    if (target instanceof Element && matches.some((element) => element === target || element.contains(target))) {
      return true;
    }

    if (mutation.type !== 'childList') return false;
    return Array.from(mutation.addedNodes).some((node) => {
      if (!(node instanceof Element)) return false;
      try {
        return node.matches(containerSelector) || node.querySelector(containerSelector) !== null;
      } catch {
        return false;
      }
    });
  };

  const initialMatches = readMatches();
  const initialLength = Math.max(initialCount, initialMatches.length);
  const immediateDiff = initialMatches.length - initialCount;
  if (immediateDiff >= minNewCount) {
    return Promise.resolve({
      success: true,
      newCount: initialMatches.length,
      diff: immediateDiff,
      mutated: false,
      timedOut: false,
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      observer?.disconnect();
      observer = null;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (pollHandle) clearInterval(pollHandle);
    };

    const finish = (mutated: boolean, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      const newCount = readMatches().length;
      cleanup();
      resolve({
        success: newCount - initialCount >= minNewCount,
        newCount,
        diff: newCount - initialCount,
        mutated,
        timedOut,
      });
    };

    const observeRoot = root instanceof Document ? root.documentElement ?? root : root;
    if (typeof MutationObserver !== 'undefined' && observeRoot) {
      observer = new MutationObserver((mutations) => {
        const matches = readMatches();
        if (matches.length - initialCount >= minNewCount || mutations.some((mutation) => mutationTouchesMatch(mutation, matches))) {
          finish(true, false);
        }
      });
      observer.observe(observeRoot, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    pollHandle = setInterval(() => {
      if (readMatches().length - initialLength >= minNewCount) finish(false, false);
    }, pollIntervalMs);
    timeoutHandle = setTimeout(() => finish(false, true), timeoutMs);
  });
}

/**
 * Waits for a URL change compared to initialUrl.
 */
export async function waitForUrlChange(
  initialUrl: string,
  timeoutMs: number = 5000,
  pollIntervalMs: number = 50,
  options: { signal?: AbortSignal; getCurrentUrl?: () => string } = {}
): Promise<boolean> {
  const startTime = Date.now();
  const readUrl =
    options.getCurrentUrl ?? (() => (typeof window !== 'undefined' ? window.location.href : ''));

  while (Date.now() - startTime < timeoutMs && !options.signal?.aborted) {
    const currentUrl = readUrl();
    if (currentUrl && currentUrl !== initialUrl) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return false;
}
