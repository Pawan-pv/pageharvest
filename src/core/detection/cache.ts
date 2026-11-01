/**
 * Detection Caching & Bounded Traversal Utilities
 * Avoids expensive full-page DOM traversal on hover and handles large DOM trees.
 */

export interface ElementFingerprint {
  tag: string;
  classes: string[];
  childTagSequence: string[];
  depth: number;
  childCount: number;
  textSnippet: string;
  hasLink: boolean;
  hasImage: boolean;
  hasPriceOrNumber: boolean;
}

export class DetectionCache {
  private static instance: DetectionCache;
  private fingerprintCache = new WeakMap<Element, ElementFingerprint>();
  private selectorMatchCache = new Map<string, { elements: Element[]; timestamp: number }>();
  private ttlMs: number;

  constructor(ttlMs: number = 3000) {
    this.ttlMs = ttlMs;
  }

  public static getInstance(): DetectionCache {
    if (!DetectionCache.instance) {
      DetectionCache.instance = new DetectionCache();
    }
    return DetectionCache.instance;
  }

  public getFingerprint(el: Element): ElementFingerprint | undefined {
    return this.fingerprintCache.get(el);
  }

  public setFingerprint(el: Element, fp: ElementFingerprint): void {
    this.fingerprintCache.set(el, fp);
  }

  public getQueryMatches(selector: string): Element[] | undefined {
    const entry = this.selectorMatchCache.get(selector);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.selectorMatchCache.delete(selector);
      return undefined;
    }
    return entry.elements;
  }

  public setQueryMatches(selector: string, elements: Element[]): void {
    this.selectorMatchCache.set(selector, {
      elements,
      timestamp: Date.now(),
    });
    // Keep cache bounded
    if (this.selectorMatchCache.size > 100) {
      const oldestKey = this.selectorMatchCache.keys().next().value;
      if (oldestKey) this.selectorMatchCache.delete(oldestKey);
    }
  }

  public clear(): void {
    this.selectorMatchCache.clear();
  }
}

/**
 * Traverses upwards from an anchor element up to maxLevels without exceeding root boundaries.
 */
export function getBoundedAncestry(
  anchor: Element,
  maxLevels: number = 8,
  boundary: Element | null = null
): Element[] {
  const ancestors: Element[] = [];
  let current: Element | null = anchor;
  let level = 0;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement &&
    current !== boundary &&
    level < maxLevels
  ) {
    ancestors.push(current);
    current = current.parentElement;
    level++;
  }

  return ancestors;
}

/**
 * Samples children of a parent to avoid expensive operations on containers with thousands of items.
 */
export function sampleElements<T>(items: T[], limit: number = 10): T[] {
  if (items.length <= limit) return items;
  const step = Math.floor(items.length / limit);
  const sampled: T[] = [];
  for (let i = 0; i < limit; i++) {
    const idx = Math.min(i * step, items.length - 1);
    sampled.push(items[idx]);
  }
  return sampled;
}
