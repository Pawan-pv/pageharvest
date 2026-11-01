/**
 * Navigation, Pagination & Infinite Scroll Runner
 *
 * Provides control detection, pagination execution, infinite scrolling,
 * and integration with the PageHarvest multi-page extraction engine.
 */

export * from './types';
export * from './detector';
export * from './stability';
export * from './url-paginator';
export * from './scroller';
export * from './engine';

import {
  findNextPageControl,
  isControlDisabled,
} from './detector';
import { performScrollStep } from './scroller';

export interface NextButtonCandidate {
  element: Element;
  isAnchor: boolean;
  href?: string;
  isDisabled: boolean;
}

export interface PaginationStepResult {
  success: boolean;
  action: 'clicked' | 'navigated' | 'none';
  targetUrl?: string;
  error?: string;
}

export interface ScrollStepResult {
  scrolled: boolean;
  reachedBottom: boolean;
  currentScrollY: number;
  totalHeight: number;
}

/**
 * Checks whether an element appears disabled in the DOM.
 */
export function isElementDisabled(el: Element): boolean {
  return isControlDisabled(el);
}

/**
 * Heuristically finds the next page navigation element on the page.
 */
export function findNextPageButton(
  customSelector?: string,
  root: Document | Element = document
): NextButtonCandidate | null {
  const control = findNextPageControl(root, customSelector);
  if (!control) return null;

  return {
    element: control.element,
    isAnchor: control.isAnchor,
    href: control.href,
    isDisabled: control.isDisabled,
  };
}

/**
 * Executes a click or navigation to the next page.
 */
export function executePaginationStep(
  customSelector?: string,
  root: Document | Element = document
): PaginationStepResult {
  const candidate = findNextPageControl(root, customSelector);

  if (!candidate) {
    return {
      success: false,
      action: 'none',
      error: 'Next page button not found',
    };
  }

  if (candidate.isDisabled) {
    return {
      success: false,
      action: 'none',
      error: 'Next page button is disabled (last page reached)',
    };
  }

  // Dispatch click event
  try {
    if (typeof (candidate.element as HTMLElement).click === 'function') {
      (candidate.element as HTMLElement).click();
    } else {
      const clickEvent = new Event('click', { bubbles: true, cancelable: true });
      candidate.element.dispatchEvent(clickEvent);
    }

    return {
      success: true,
      action: candidate.isAnchor && candidate.href ? 'navigated' : 'clicked',
      targetUrl: candidate.href,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      action: 'none',
      error: `Failed to trigger next page click: ${message}`,
    };
  }
}

/**
 * Executes a smooth scroll step for infinite scroll extraction.
 */
export function executeScrollStep(distancePx: number = 800): ScrollStepResult {
  const result = performScrollStep({ distancePx });
  return {
    scrolled: result.scrolled,
    reachedBottom: result.reachedBottom,
    currentScrollY: result.currentScrollY,
    totalHeight: result.totalHeight,
  };
}
