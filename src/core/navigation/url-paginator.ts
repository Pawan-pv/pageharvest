/**
 * Normalizes a URL for deterministic duplicate and cyclic loop detection.
 * Removes fragments, normalizes trailing slashes, and sorts query parameters.
 */
export function normalizeUrlForDeduplication(rawUrl: string): string {
  if (!rawUrl) return '';

  try {
    const parsed = new URL(rawUrl);
    // Strip hash/fragment
    parsed.hash = '';

    // Normalize trailing slash on pathname
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    // Sort search parameters deterministically
    const params = new URLSearchParams(parsed.search);
    const sortedKeys = Array.from(params.keys()).sort();
    const sortedParams = new URLSearchParams();
    for (const key of sortedKeys) {
      const values = params.getAll(key);
      for (const val of values) {
        sortedParams.append(key, val);
      }
    }
    parsed.search = sortedParams.toString();

    return parsed.href;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export interface NextUrlOptions {
  currentPage: number;
  nextPage: number;
  pageSize?: number;
  template?: string;
}

/**
 * Generates the target URL for the next page given current URL and pagination state.
 */
export function generateNextPageUrl(currentUrl: string, options: NextUrlOptions): string {
  const { currentPage, nextPage, pageSize = 20, template } = options;

  // 1. Explicit template provided (e.g. https://example.com/items?page={page})
  if (template && template.includes('{page}')) {
    return template.replace(/\{page\}/g, String(nextPage));
  }
  if (template && template.includes('{offset}')) {
    const nextOffset = (nextPage - 1) * pageSize;
    return template.replace(/\{offset\}/g, String(nextOffset));
  }

  try {
    const parsed = new URL(currentUrl);

    // 2. Query param offset
    if (parsed.searchParams.has('offset')) {
      const currentOffset = parseInt(parsed.searchParams.get('offset') || '0', 10);
      const limit = parseInt(parsed.searchParams.get('limit') || String(pageSize), 10);
      parsed.searchParams.set('offset', String(currentOffset + limit));
      return parsed.href;
    }

    // 3. Query param page / p / pg
    const pageParams = ['page', 'p', 'pg', 'paged', 'page_num', 'pageIndex'];
    for (const p of pageParams) {
      if (parsed.searchParams.has(p)) {
        parsed.searchParams.set(p, String(nextPage));
        return parsed.href;
      }
    }

    // 4. Path-based /page/(\d+)
    if (/(.*\/page\/)\d+(\/?.*)/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(
        /(.*\/page\/)\d+(\/?.*)/i,
        `$1${nextPage}$2`
      );
      return parsed.href;
    }

    // 5. Path-based /p/(\d+)
    if (/(.*\/p\/)\d+(\/?.*)/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(
        /(.*\/p\/)\d+(\/?.*)/i,
        `$1${nextPage}$2`
      );
      return parsed.href;
    }

    // Default: append page query param
    parsed.searchParams.set('page', String(nextPage));
    return parsed.href;
  } catch {
    // If not a valid full URL, fallback to simple string replace
    if (currentUrl.includes('page=')) {
      return currentUrl.replace(/page=\d+/, `page=${nextPage}`);
    }
    const separator = currentUrl.includes('?') ? '&' : '?';
    return `${currentUrl}${separator}page=${nextPage}`;
  }
}

/**
 * Runner that tracks visited URLs to prevent cyclic navigation loops.
 */
export function createUrlPaginationRunner(options: {
  startUrl: string;
  maxPages?: number;
}) {
  const visitedUrls = new Set<string>();
  let loopDetected = false;

  const initialNormalized = normalizeUrlForDeduplication(options.startUrl);
  if (initialNormalized) {
    visitedUrls.add(initialNormalized);
  }

  return {
    visit(url: string): boolean {
      const normalized = normalizeUrlForDeduplication(url);
      if (visitedUrls.has(normalized)) {
        loopDetected = true;
        return false;
      }
      visitedUrls.add(normalized);
      return true;
    },
    hasVisited(url: string): boolean {
      return visitedUrls.has(normalizeUrlForDeduplication(url));
    },
    isLoopDetected(): boolean {
      return loopDetected;
    },
    getVisitedUrls(): string[] {
      return Array.from(visitedUrls);
    },
  };
}
