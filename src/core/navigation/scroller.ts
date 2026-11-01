export interface ScrollExecutionOptions {
  distancePx?: number;
  containerSelector?: string;
}

export interface ScrollExecutionResult {
  scrolled: boolean;
  reachedBottom: boolean;
  currentScrollY: number;
  totalHeight: number;
  clientVisibleHeight: number;
}

/**
 * Performs a single smooth scroll step on window or a designated scrollable container element.
 */
export function performScrollStep(options: ScrollExecutionOptions = {}): ScrollExecutionResult {
  const { distancePx = 800, containerSelector } = options;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      scrolled: false,
      reachedBottom: true,
      currentScrollY: 0,
      totalHeight: 0,
      clientVisibleHeight: 0,
    };
  }

  // If a custom scroll container is specified
  if (containerSelector) {
    const container = document.querySelector(containerSelector);
    if (container) {
      const prevScrollTop = container.scrollTop;
      container.scrollBy({ top: distancePx, behavior: 'smooth' });
      const currentScrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const reachedBottom = currentScrollTop + clientHeight >= scrollHeight - 30;

      return {
        scrolled: currentScrollTop !== prevScrollTop || !reachedBottom,
        reachedBottom,
        currentScrollY: currentScrollTop,
        totalHeight: scrollHeight,
        clientVisibleHeight: clientHeight,
      };
    }
  }

  // Window scroll
  const prevScrollY = window.scrollY;
  if (typeof window.scrollBy === 'function') {
    window.scrollBy({ top: distancePx, behavior: 'smooth' });
  }

  const currentScrollY = window.scrollY;
  const viewportHeight = window.innerHeight || 800;
  const docHeight = Math.max(
    document.body?.scrollHeight || 0,
    document.documentElement?.scrollHeight || 0,
    document.body?.offsetHeight || 0,
    document.documentElement?.offsetHeight || 0
  );

  const reachedBottom = currentScrollY + viewportHeight >= docHeight - 50;

  return {
    scrolled: currentScrollY !== prevScrollY || !reachedBottom,
    reachedBottom,
    currentScrollY,
    totalHeight: docHeight,
    clientVisibleHeight: viewportHeight,
  };
}
