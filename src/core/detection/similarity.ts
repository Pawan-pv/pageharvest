import { DetectionCache, ElementFingerprint } from './cache';
import { filterMeaningfulClasses } from '@/utils/selector';
import { normalizeText } from '@/utils/dom';

const VOLATILE_CLASS_REGEX = /^(active|hover|focus|focus-within|open|expanded|selected|collapsed|disabled|is-.*|has-.*|js-.*)$/i;

/**
 * Filters out stateful/ephemeral classes that change dynamically
 */
export function sanitizeClassList(classList: DOMTokenList | string[]): string[] {
  const classes = Array.from(classList);
  return filterMeaningfulClasses(classes).filter((cls) => !VOLATILE_CLASS_REGEX.test(cls));
}

/**
 * Computes a structural fingerprint for an element, cached via WeakMap.
 */
export function getElementFingerprint(el: Element): ElementFingerprint {
  const cache = DetectionCache.getInstance();
  const cached = cache.getFingerprint(el);
  if (cached) return cached;

  const tag = el.tagName.toLowerCase();
  const classes = sanitizeClassList(el.classList).sort();
  const childTagSequence = Array.from(el.children)
    .filter((c) => c.nodeType === Node.ELEMENT_NODE && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE')
    .map((c) => c.tagName.toLowerCase());

  let depth = 0;
  let p = el.parentElement;
  while (p && p !== document.body) {
    depth++;
    p = p.parentElement;
  }

  const textSnippet = normalizeText(el.textContent).slice(0, 100);
  const hasLink = el.tagName === 'A' || el.querySelector('a[href]') !== null;
  const hasImage = el.tagName === 'IMG' || el.querySelector('img, [style*="background-image"]') !== null;
  const hasPriceOrNumber = /[$€£¥₹]|\b(USD|EUR|GBP|INR)\b/i.test(textSnippet);

  const fp: ElementFingerprint = {
    tag,
    classes,
    childTagSequence,
    depth,
    childCount: childTagSequence.length,
    textSnippet,
    hasLink,
    hasImage,
    hasPriceOrNumber,
  };

  cache.setFingerprint(el, fp);
  return fp;
}

/**
 * Calculates Dice coefficient similarity between two arrays of tokens.
 */
function diceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const bCounts = new Map<string, number>();
  for (const item of b) {
    bCounts.set(item, (bCounts.get(item) || 0) + 1);
  }

  let intersection = 0;
  for (const item of a) {
    const count = bCounts.get(item) || 0;
    if (count > 0) {
      intersection++;
      bCounts.set(item, count - 1);
    }
  }

  return (2 * intersection) / (a.length + b.length);
}

/**
 * Computes a structural similarity score in [0.0, 1.0] between two DOM elements.
 */
export function calculateTreeSimilarity(a: Element, b: Element): number {
  if (a === b) return 1.0;

  const fpA = getElementFingerprint(a);
  const fpB = getElementFingerprint(b);

  if (fpA.tag !== fpB.tag) {
    return 0.1;
  }

  // 1. Child sequence similarity (weight 0.40)
  const childSeqSim = diceSimilarity(fpA.childTagSequence, fpB.childTagSequence);

  // 2. Child count ratio (weight 0.20)
  const maxChildren = Math.max(fpA.childCount, fpB.childCount);
  const childCountSim = maxChildren === 0 ? 1.0 : Math.min(fpA.childCount, fpB.childCount) / maxChildren;

  // 3. Class list similarity (weight 0.25)
  const classSim = diceSimilarity(fpA.classes, fpB.classes);

  // 4. Feature flags (weight 0.15)
  let featureMatches = 0;
  if (fpA.hasLink === fpB.hasLink) featureMatches++;
  if (fpA.hasImage === fpB.hasImage) featureMatches++;
  if (fpA.hasPriceOrNumber === fpB.hasPriceOrNumber) featureMatches++;
  const featureSim = featureMatches / 3;

  const compositeSimilarity =
    0.4 * childSeqSim +
    0.2 * childCountSim +
    0.25 * classSim +
    0.15 * featureSim;

  return Math.min(1.0, Math.max(0.0, compositeSimilarity));
}

/**
 * Fast $O(N)$ Sibling Clustering with Fast-Path Bucket Hashing
 * Prevents expensive full-page DOM traversal on large DOM trees.
 */
export function clusterSiblings(
  parent: Element,
  sampleTarget?: Element,
  similarityThreshold: number = 0.65
): Element[][] {
  const children = Array.from(parent.children).filter(
    (c) =>
      c.nodeType === Node.ELEMENT_NODE &&
      c.tagName !== 'SCRIPT' &&
      c.tagName !== 'STYLE' &&
      c.tagName !== 'TEMPLATE' &&
      c.tagName !== 'NOSCRIPT'
  );

  if (children.length < 2) {
    return children.length === 1 ? [[children[0]]] : [];
  }

  // Fast-Path: Bucket by Tag + Primary Classes
  // In repeating grids/lists with hundreds or thousands of items, >95% share exact tag + class
  const buckets = new Map<string, Element[]>();
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    const meaningfulCls = sanitizeClassList(child.classList).sort().join('.');
    const key = `${tag}|${meaningfulCls}`;
    const list = buckets.get(key) || [];
    list.push(child);
    buckets.set(key, list);
  }

  // If only a few buckets or large sibling count, cluster bucket representatives
  const bucketKeys = Array.from(buckets.keys());
  if (bucketKeys.length === 1) {
    return [children];
  }

  // Cluster representatives of buckets
  const clusters: Element[][] = [];
  const representativeMap = new Map<string, Element>();
  for (const key of bucketKeys) {
    const list = buckets.get(key)!;
    representativeMap.set(key, list[0]);
  }

  for (const key of bucketKeys) {
    const rep = representativeMap.get(key)!;
    const items = buckets.get(key)!;
    let merged = false;

    for (const cluster of clusters) {
      const clusterRep = cluster[0];
      if (calculateTreeSimilarity(clusterRep, rep) >= similarityThreshold) {
        cluster.push(...items);
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push([...items]);
    }
  }

  // Sort clusters: if sampleTarget is provided, put its cluster first
  if (sampleTarget) {
    clusters.sort((a, b) => {
      const aHas = a.includes(sampleTarget) ? 1 : 0;
      const bHas = b.includes(sampleTarget) ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return b.length - a.length;
    });
  } else {
    clusters.sort((a, b) => b.length - a.length);
  }

  return clusters;
}
