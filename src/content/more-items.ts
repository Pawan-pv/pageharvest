import { findLoadMoreControl, findNextPageControl, isLoadMoreText } from '@/core/navigation/detector';
import type { MoreItemsHint } from '@/shared/contracts/message';

/**
 * Whether the page offers a way to more items: a Next control, a Load more control, or
 * neither (ADR-039). It only reads the DOM, with the same finders a job uses, and never
 * clicks, scrolls or focuses anything. The answer words a question in the side panel and
 * nothing else: the background never sees it, and a job still finds its own control.
 */
export function findMoreItems(root: Document): MoreItemsHint {
  // A disabled control is the last page: there is nothing more to offer.
  const next = findNextPageControl(root);
  if (next && !next.isDisabled) return isLoadMoreText(next.text) ? 'load_more' : 'next';
  const loadMore = findLoadMoreControl(root);
  return loadMore && !loadMore.isDisabled ? 'load_more' : 'none';
}
