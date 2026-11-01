import {
  DetectedListResult,
  DetectionOptions,
  DiscoveredField,
  CandidateSample,
} from '@/types/detection';
import { getBoundedAncestry, sampleElements } from './cache';
import { clusterSiblings } from './similarity';
import { calculateConfidence } from './confidence';
import { discoverFieldsInCluster } from './fields';
import { generateRepeatedSelector, createCandidateSample } from './repeated';
import { generateCssSelector } from '@/utils/selector';

/**
 * Determines a human-readable name for a detected list based on its semantic tags,
 * classes, and discovered field types.
 */
export function inferListName(
  items: Element[],
  parent: Element,
  fields: DiscoveredField[]
): string {
  const rep = items[0];
  const itemTag = rep.tagName.toLowerCase();
  const parentTag = parent.tagName.toLowerCase();
  const parentClass = (parent.className || '').toLowerCase();
  const itemClass = (rep.className || '').toLowerCase();

  const types = new Set(fields.map((f) => f.type));
  const hasPrice = types.has('price');
  const hasImage = types.has('image');
  const hasRating = types.has('rating');
  const hasDate = types.has('date');

  // Table rows
  if (itemTag === 'tr' || parentTag === 'tbody' || parentTag === 'table') {
    return 'Table rows';
  }

  // Job listings
  if (
    /job/i.test(itemClass) ||
    /job/i.test(parentClass) ||
    (fields.some((f) => /company|salary|apply/i.test(f.name)) && hasDate)
  ) {
    return 'Job listings';
  }

  // Business directory
  if (
    /biz|business|directory/i.test(itemClass) ||
    /biz|business|directory/i.test(parentClass) ||
    fields.some((f) => /address|phone/i.test(f.name))
  ) {
    return 'Business directory';
  }

  // Product cards
  if (
    (hasPrice && hasImage) ||
    /product/i.test(itemClass) ||
    /product/i.test(parentClass) ||
    (hasPrice && hasRating)
  ) {
    return 'Product cards';
  }

  // Article cards
  if (
    itemTag === 'article' ||
    /post|article|blog|news/i.test(itemClass) ||
    /post|article|blog|news/i.test(parentClass) ||
    (hasDate && fields.some((f) => /author|excerpt|headline/i.test(f.name)))
  ) {
    return 'Article cards';
  }

  // Semantic class fallback
  const meaningfulClass = rep.classList[0];
  if (meaningfulClass) {
    const formatted = meaningfulClass
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `${formatted}s`;
  }

  return 'Item list';
}

/**
 * Core Algorithm: Detects the enclosing repeated list and similar items starting
 * from any selected element context.
 */
export function detectListFromSelection(
  targetElement: Element,
  options?: DetectionOptions
): DetectedListResult | null {
  const maxDepth = options?.maxDepth ?? 8;
  const minItems = options?.minItems ?? 2;
  const minConfidence = options?.minConfidence ?? 0.35;
  const sampleLimit = options?.sampleLimit ?? 5;

  // Walk up from target element
  const ancestry = getBoundedAncestry(targetElement, maxDepth);
  if (ancestry.length === 0) return null;

  interface CandidateEvaluation {
    itemSelector: string;
    containerSelector: string;
    parentSelector: string;
    matchedElements: Element[];
    parent: Element;
    fields: DiscoveredField[];
    confidence: number;
    confidencePercent: number;
    factors: import('@/types/detection').ConfidenceFactors;
    depthDistance: number;
    score: number;
  }

  const evaluations: CandidateEvaluation[] = [];

  for (let d = 0; d < ancestry.length; d++) {
    const candidateItem = ancestry[d];
    const candidateParent = candidateItem.parentElement;
    if (!candidateParent) continue;

    // Cluster siblings of candidateParent that match candidateItem
    const clusters = clusterSiblings(candidateParent, candidateItem);
    const targetCluster = clusters.find((c) => c.includes(candidateItem));

    if (targetCluster && targetCluster.length >= minItems) {
      const repeatedSelector = generateRepeatedSelector(candidateParent, candidateItem);
      let matchedElements: Element[] = [];

      try {
        // Query within the document or parent
        matchedElements = Array.from(document.querySelectorAll(repeatedSelector));
      } catch {
        matchedElements = targetCluster;
      }

      // Ensure targetCluster elements are included
      if (matchedElements.length < targetCluster.length) {
        matchedElements = targetCluster;
      }

      // Check that the selected element is actually contained inside one of the matched elements
      const containsTarget = matchedElements.some(
        (el) => el === targetElement || el.contains(targetElement)
      );

      if (containsTarget && matchedElements.length >= minItems) {
        // Discover fields in the cluster
        const fields = discoverFieldsInCluster(matchedElements, options?.heuristics);

        // Calculate confidence
        const { confidence, confidencePercent, factors } = calculateConfidence({
          items: matchedElements,
          parent: candidateParent,
          discoveredFields: fields,
          totalSiblingCount: candidateParent.children.length,
        });

        if (confidence >= minConfidence) {
          const parentSel = generateCssSelector(candidateParent) || candidateParent.tagName.toLowerCase();

          // Scoring weights confidence, item count, and proximity to clicked element
          // Distance penalty is small to prefer the most specific container
          const proximityBonus = 1 / (1 + d * 0.15);
          const score = confidence * Math.log2(matchedElements.length + 1) * proximityBonus;

          evaluations.push({
            itemSelector: repeatedSelector,
            containerSelector: repeatedSelector,
            parentSelector: parentSel,
            matchedElements,
            parent: candidateParent,
            fields,
            confidence,
            confidencePercent,
            factors,
            depthDistance: d,
            score,
          });
        }
      }
    }
  }

  if (evaluations.length === 0) return null;

  // Sort candidates by score descending
  evaluations.sort((a, b) => b.score - a.score);
  const best = evaluations[0];

  const listName = inferListName(best.matchedElements, best.parent, best.fields);
  const samples: CandidateSample[] = sampleElements(best.matchedElements, sampleLimit).map(
    createCandidateSample
  );

  return {
    name: listName,
    containerSelector: best.containerSelector,
    parentSelector: best.parentSelector,
    itemSelector: best.itemSelector,
    itemCount: best.matchedElements.length,
    confidence: best.confidence,
    confidencePercent: best.confidencePercent,
    confidenceFactors: best.factors,
    availableFields: best.fields,
    sampleElements: samples,
    matchedElements: best.matchedElements,
  };
}

/**
 * Auto-detects all repeated lists across the document, ranked by confidence and size.
 */
export function autoDetectLists(
  root: Document | Element = document,
  options?: DetectionOptions
): DetectedListResult[] {
  const candidateContainers = root.querySelectorAll(
    'ul, ol, tbody, [class*="list" i], [class*="grid" i], [class*="items" i], [class*="cards" i], [class*="results" i], [role="feed"], [role="grid"]'
  );

  const results: DetectedListResult[] = [];
  const seenSelectors = new Set<string>();

  for (const container of Array.from(candidateContainers)) {
    const firstChild = Array.from(container.children).find(
      (c) => c.nodeType === Node.ELEMENT_NODE && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE'
    );
    if (!firstChild) continue;

    const detected = detectListFromSelection(firstChild, options);
    if (detected && !seenSelectors.has(detected.containerSelector)) {
      seenSelectors.add(detected.containerSelector);
      results.push(detected);
    }
  }

  return results.sort((a, b) => b.confidence * b.itemCount - a.confidence * a.itemCount);
}

/**
 * Allows editing field names, selectors, extractors, and required mappings.
 */
export function updateFieldMapping(
  listResult: DetectedListResult,
  fieldId: string,
  updates: Partial<DiscoveredField>
): DetectedListResult {
  const updatedFields = listResult.availableFields.map((f) => {
    if (f.id === fieldId) {
      return { ...f, ...updates };
    }
    return f;
  });

  return {
    ...listResult,
    availableFields: updatedFields,
  };
}
