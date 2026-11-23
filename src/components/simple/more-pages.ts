import type { MoreItemsHint } from '@/shared/contracts/message';
import type { ExtractionPaginationConfig } from '@/types';

/**
 * "More pages" in simple mode (ADR-039). One question replaces the four ways of paging:
 * does the list continue, and if so, how far to follow it. The answer is written into the
 * same pagination settings a job has always used; nothing new reaches the background.
 */

/** How far simple mode follows a list unless the user says otherwise. */
export const SIMPLE_DEFAULT_PAGES = 5;
export const SIMPLE_DEFAULT_SCROLLS = 10;
/** The most a simple-mode user can ask for. Higher limits are under Advanced options. */
export const SIMPLE_MAX_PAGES = 50;

/** What the user answered. */
export type MorePagesAnswer = 'no' | 'next' | 'scroll';

/** The page showed a Next or "Load more" control when the list was found. */
export function listContinues(hint: MoreItemsHint | undefined): boolean {
  return hint === 'next' || hint === 'load_more';
}

export function answerFor(pagination: Pick<ExtractionPaginationConfig, 'type'>): MorePagesAnswer {
  if (pagination.type === 'infinite_scroll') return 'scroll';
  return pagination.type === 'none' ? 'no' : 'next';
}

function clampCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(SIMPLE_MAX_PAGES, Math.max(1, Math.round(value)));
}

/**
 * The pagination settings for an answer. `count` is pages for a Next button and scrolls for
 * a scrolling page, kept between 1 and 50.
 */
export function settingsForAnswer(answer: MorePagesAnswer, count?: number): Partial<ExtractionPaginationConfig> {
  switch (answer) {
    case 'next':
      return { type: 'next_button', maxPages: clampCount(count, SIMPLE_DEFAULT_PAGES) };
    case 'scroll':
      return { type: 'infinite_scroll', scrollCount: clampCount(count, SIMPLE_DEFAULT_SCROLLS) };
    default:
      return { type: 'none' };
  }
}

/**
 * Where simple mode starts for a newly found list: follow it when the page shows a way to
 * more items, otherwise just this page. Settings that only Advanced options can show are
 * cleared, so nothing the user cannot see changes what the job does.
 */
export function simpleStartingPagination(hint: MoreItemsHint | undefined): Partial<ExtractionPaginationConfig> {
  return {
    maxPages: SIMPLE_DEFAULT_PAGES,
    scrollCount: SIMPLE_DEFAULT_SCROLLS,
    nextButtonSelector: undefined,
    urlTemplate: undefined,
    maxRecords: undefined,
    ...settingsForAnswer(listContinues(hint) ? 'next' : 'no'),
  };
}
