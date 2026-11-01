import { normalizeText } from '@/utils/dom';
import { generateCssSelector } from '@/utils/selector';
import {
  NavigationStrategy,
  PaginationControl,
  PaginationDetectorResult,
} from './types';

/**
 * Checks whether an element appears disabled in the DOM.
 */
export function isControlDisabled(el: Element): boolean {
  if (!el) return true;
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  if (
    el.classList.contains('disabled') ||
    el.classList.contains('is-disabled') ||
    el.classList.contains('inactive')
  ) {
    return true;
  }
  if (el.getAttribute('tabindex') === '-1' && el.tagName.toLowerCase() === 'a') {
    return true;
  }
  return false;
}

/**
 * Common non-pagination action verbs and terms that should NEVER be clicked as pagination controls.
 * Guarantees we only interact with identified pagination controls and user-approved actions.
 */
const NON_PAGINATION_PATTERNS = [
  /add\s+to\s+cart/i,
  /buy\s+now/i,
  /checkout/i,
  /purchase/i,
  /submit/i,
  /delete/i,
  /remove/i,
  /filter/i,
  /search/i,
  /sign\s+(in|up)/i,
  /log\s+(in|out)/i,
  /register/i,
  /subscribe/i,
  /apply/i,
  /coupon/i,
  /promo/i,
  /close/i,
  /cancel/i,
  /save/i,
  /edit/i,
  /share/i,
  /like/i,
  /favorite/i,
  /wishlist/i,
  /contact/i,
  /download/i,
  /sort\s+by/i,
  /agree/i,
  /accept/i,
  /cookie/i,
];

/**
 * Checks whether a button/link is an arbitrary site action that must NOT be clicked for pagination.
 */
export function isArbitraryNonPaginationButton(el: Element): boolean {
  const text = normalizeText(el.textContent);
  const ariaLabel = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title'));
  const fullText = `${text} ${ariaLabel}`.trim();

  // If it clearly indicates pagination, it is not arbitrary non-pagination
  if (
    isNextButtonText(text) ||
    isNextButtonText(ariaLabel) ||
    isLoadMoreText(text) ||
    isLoadMoreText(ariaLabel) ||
    ariaLabel.toLowerCase().includes('next') ||
    ariaLabel.toLowerCase().includes('load more')
  ) {
    return false;
  }

  for (const pattern of NON_PAGINATION_PATTERNS) {
    if (pattern.test(fullText)) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether text matches next page indicators.
 */
export function isNextButtonText(rawText: string): boolean {
  const text = normalizeText(rawText).trim().toLowerCase();
  if (!text) return false;

  if (/^next(\s+page)?$/i.test(text)) return true;
  if (/^next\s*(&gt;|>|»|›|→)?$/i.test(text)) return true;
  if (/^(&gt;|>|»|›|→)$/.test(text)) return true;
  if (/^older(\s+posts)?\s*(&gt;|>|»|›|→)?$/i.test(text)) return true;
  if (text.startsWith('next ') || text.endsWith(' next')) return true;

  return false;
}

/**
 * Determines whether text matches load more indicators.
 */
export function isLoadMoreText(rawText: string): boolean {
  const text = normalizeText(rawText).trim().toLowerCase();
  if (!text) return false;

  return (
    text.startsWith('load more') ||
    text.startsWith('show more') ||
    text.startsWith('view more') ||
    text.startsWith('see more') ||
    text === 'more'
  );
}

/**
 * Discovers the Next Page control in the DOM.
 */
export function findNextPageControl(
  root: Document | Element = document,
  customSelector?: string
): PaginationControl | null {
  // 1. Custom user-provided selector
  if (customSelector && customSelector.trim()) {
    try {
      const el = root.querySelector(customSelector);
      if (el) {
        const isAnchor = el.tagName.toLowerCase() === 'a';
        return {
          element: el,
          strategy: 'next_link',
          confidence: 1.0,
          selector: customSelector,
          isAnchor,
          href: isAnchor ? (el as HTMLAnchorElement).href : undefined,
          text: normalizeText(el.textContent),
          isDisabled: isControlDisabled(el),
        };
      }
    } catch {
      // Fall through if custom selector is invalid
    }
  }

  // 2. Standard rel="next"
  try {
    const relNext = root.querySelector('a[rel="next"], [rel*="next"]');
    if (relNext && !isArbitraryNonPaginationButton(relNext)) {
      const isAnchor = relNext.tagName.toLowerCase() === 'a';
      return {
        element: relNext,
        strategy: 'next_link',
        confidence: 0.95,
        selector: generateCssSelector(relNext) || 'a[rel="next"]',
        isAnchor,
        href: isAnchor ? (relNext as HTMLAnchorElement).href : undefined,
        text: normalizeText(relNext.textContent),
        isDisabled: isControlDisabled(relNext),
      };
    }
  } catch {
    // Ignore selector syntax issues in non-standard DOM environments
  }

  // 3. aria-label containing "next" (safe check without CSS selector flags)
  const ariaElements = Array.from(root.querySelectorAll('[aria-label]'));
  for (const el of ariaElements) {
    if (isArbitraryNonPaginationButton(el)) continue;
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('next')) {
      const isAnchor = el.tagName.toLowerCase() === 'a';
      return {
        element: el,
        strategy: 'next_link',
        confidence: 0.85,
        selector: generateCssSelector(el),
        isAnchor,
        href: isAnchor ? (el as HTMLAnchorElement).href : undefined,
        text: normalizeText(el.textContent) || normalizeText(el.getAttribute('aria-label')),
        isDisabled: isControlDisabled(el),
      };
    }
  }

  // 4. Text-matching candidate search across buttons and links
  const textCandidates = Array.from(root.querySelectorAll('a, button, [role="button"], input[type="button"]'));
  for (const el of textCandidates) {
    if (isArbitraryNonPaginationButton(el)) continue;
    const text = normalizeText(el.textContent);
    if (isNextButtonText(text)) {
      const isAnchor = el.tagName.toLowerCase() === 'a';
      return {
        element: el,
        strategy: 'next_link',
        confidence: 0.8,
        selector: generateCssSelector(el),
        isAnchor,
        href: isAnchor ? (el as HTMLAnchorElement).href : undefined,
        text,
        isDisabled: isControlDisabled(el),
      };
    }
  }

  // 5. Active pagination item sibling (e.g. .pagination .active + li a)
  try {
    const siblingCandidate = root.querySelector(
      '.pagination .active + li a, .pagination .current + li a, [class*="pagination"] [aria-current="page"] + * a, .pagination li.active + li a'
    );
    if (siblingCandidate && !isArbitraryNonPaginationButton(siblingCandidate)) {
      const isAnchor = siblingCandidate.tagName.toLowerCase() === 'a';
      return {
        element: siblingCandidate,
        strategy: 'next_link',
        confidence: 0.75,
        selector: generateCssSelector(siblingCandidate),
        isAnchor,
        href: isAnchor ? (siblingCandidate as HTMLAnchorElement).href : undefined,
        text: normalizeText(siblingCandidate.textContent),
        isDisabled: isControlDisabled(siblingCandidate),
      };
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Discovers a Load More / Show More button in the DOM.
 */
export function findLoadMoreControl(
  root: Document | Element = document,
  customSelector?: string
): PaginationControl | null {
  if (customSelector && customSelector.trim()) {
    try {
      const el = root.querySelector(customSelector);
      if (el) {
        const isAnchor = el.tagName.toLowerCase() === 'a';
        return {
          element: el,
          strategy: 'load_more',
          confidence: 1.0,
          selector: customSelector,
          isAnchor,
          href: isAnchor ? (el as HTMLAnchorElement).href : undefined,
          text: normalizeText(el.textContent),
          isDisabled: isControlDisabled(el),
        };
      }
    } catch {
      // Continue
    }
  }

  const candidates = Array.from(root.querySelectorAll('button, a, [role="button"], .load-more, .show-more'));
  for (const el of candidates) {
    if (isArbitraryNonPaginationButton(el)) continue;
    const text = normalizeText(el.textContent);
    if (isLoadMoreText(text)) {
      const isAnchor = el.tagName.toLowerCase() === 'a';
      return {
        element: el,
        strategy: 'load_more',
        confidence: 0.88,
        selector: generateCssSelector(el),
        isAnchor,
        href: isAnchor ? (el as HTMLAnchorElement).href : undefined,
        text,
        isDisabled: isControlDisabled(el),
      };
    }
  }

  return null;
}

/**
 * Detects URL pagination query parameters and path structures.
 */
export function detectUrlPagination(currentUrl: string): {
  template: string;
  paramName?: string;
  currentPage: number;
  nextPage: number;
} | null {
  if (!currentUrl) return null;

  try {
    const parsed = new URL(currentUrl);

    // 1. Query parameters: page, p, pg, offset
    const searchParams = parsed.searchParams;
    const commonParamNames = ['page', 'p', 'pg', 'paged', 'page_num', 'pageIndex'];

    for (const param of commonParamNames) {
      if (searchParams.has(param)) {
        const val = parseInt(searchParams.get(param) || '', 10);
        if (!isNaN(val) && val >= 1) {
          const urlObj = new URL(currentUrl);
          urlObj.searchParams.set(param, '{page}');
          return {
            template: decodeURIComponent(urlObj.href),
            paramName: param,
            currentPage: val,
            nextPage: val + 1,
          };
        }
      }
    }

    // Offset pattern
    if (searchParams.has('offset') && searchParams.has('limit')) {
      const offset = parseInt(searchParams.get('offset') || '', 10);
      const limit = parseInt(searchParams.get('limit') || '', 10);
      if (!isNaN(offset) && !isNaN(limit) && limit > 0) {
        const currentPage = Math.floor(offset / limit) + 1;
        const urlObj = new URL(currentUrl);
        urlObj.searchParams.set('offset', '{offset}');
        return {
          template: decodeURIComponent(urlObj.href),
          paramName: 'offset',
          currentPage,
          nextPage: currentPage + 1,
        };
      }
    }

    // 2. Path patterns: /page/1/, /p/2
    const pathMatch = parsed.pathname.match(/(.*\/page\/)(\d+)(\/?.*)/i);
    if (pathMatch) {
      const current = parseInt(pathMatch[2], 10);
      const template = `${parsed.origin}${pathMatch[1]}{page}${pathMatch[3]}${parsed.search}`;
      return {
        template,
        currentPage: current,
        nextPage: current + 1,
      };
    }

    const pPathMatch = parsed.pathname.match(/(.*\/p\/)(\d+)(\/?.*)/i);
    if (pPathMatch) {
      const current = parseInt(pPathMatch[2], 10);
      const template = `${parsed.origin}${pPathMatch[1]}{page}${pPathMatch[3]}${parsed.search}`;
      return {
        template,
        currentPage: current,
        nextPage: current + 1,
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Unified detector that inspects page DOM and URL to recommend the optimal navigation strategy.
 */
export function detectPagination(
  root: Document | Element = document,
  currentUrl?: string
): PaginationDetectorResult {
  const controls: PaginationControl[] = [];
  const activeUrl = currentUrl || (typeof window !== 'undefined' ? window.location.href : '');

  // 1. Detect Load More control
  const loadMore = findLoadMoreControl(root);
  if (loadMore) {
    controls.push(loadMore);
  }

  // 2. Detect Next Page control
  const nextBtn = findNextPageControl(root);
  if (nextBtn) {
    controls.push(nextBtn);
  }

  // 3. Detect URL pattern
  const urlPattern = detectUrlPagination(activeUrl) || undefined;

  // 4. Determine recommended strategy
  const sentinel = root.querySelector('#scroll-sentinel, [class*="sentinel"], [class*="infinite-scroll"]');
  const recommendedStrategy: NavigationStrategy = loadMore &&
    (!nextBtn || loadMore.confidence >= nextBtn.confidence)
    ? 'load_more'
    : nextBtn
      ? 'next_link'
      : urlPattern
        ? 'url_pagination'
        : sentinel
          ? 'infinite_scroll'
          : 'manual';

  return {
    recommendedStrategy,
    controls,
    urlPattern,
  };
}
