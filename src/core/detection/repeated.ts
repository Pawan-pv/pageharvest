import { RepeatedPatternCandidate, CandidateSample } from '@/types';
import { filterMeaningfulClasses, escapeCss, isDynamicId } from '@/utils/selector';
import { visibleText } from '@/utils/dom';

/**
 * Computes a structural signature for an element based on its tag, classes, and immediate children tags.
 */
export function getElementSignature(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = filterMeaningfulClasses(el.classList).sort().join('.');
  const childTags = Array.from(el.children)
    .map((c) => c.tagName.toLowerCase())
    .slice(0, 5)
    .join('>');
  return `${tag}|${classes}|${childTags}`;
}

/**
 * Formats a sample summary of an element for UI display
 */
export function createCandidateSample(el: Element): CandidateSample {
  return {
    tag: el.tagName.toLowerCase(),
    previewText: visibleText(el).slice(0, 100),
    classes: filterMeaningfulClasses(el.classList),
  };
}

/**
 * Generates the most concise and accurate CSS selector for a repeated set of elements under a parent.
 */
export function generateRepeatedSelector(parent: Element, sampleChild: Element): string {
  const childTag = sampleChild.tagName.toLowerCase();
  const meaningfulClasses = filterMeaningfulClasses(sampleChild.classList);

  // Fast parent selector without full-document scan
  let parentSelector = '';
  if (parent.id && !isDynamicId(parent.id)) {
    parentSelector = `#${escapeCss(parent.id)}`;
  } else {
    const parentClasses = filterMeaningfulClasses(parent.classList);
    if (parentClasses.length > 0) {
      parentSelector = `${parent.tagName.toLowerCase()}.${parentClasses.map(escapeCss).join('.')}`;
    } else if (parent.tagName.toLowerCase() !== 'body' && parent.tagName.toLowerCase() !== 'html') {
      parentSelector = parent.tagName.toLowerCase();
    }
  }

  // If child has meaningful classes, try class selector
  if (meaningfulClasses.length > 0) {
    const classCandidate = `${childTag}.${meaningfulClasses.map(escapeCss).join('.')}`;
    if (parentSelector) {
      return `${parentSelector} > ${classCandidate}`;
    }
    return classCandidate;
  }

  // Fallback to parent > childTag
  if (parentSelector) {
    return `${parentSelector} > ${childTag}`;
  }
  return childTag;
}

/**
 * Detects repeated item patterns starting from a user-clicked anchor element.
 */
export function detectRepeatedFromAnchor(anchorElement: Element): RepeatedPatternCandidate[] {
  const candidates: RepeatedPatternCandidate[] = [];
  let current: Element | null = anchorElement;
  const visitedParents = new Set<Element>();

  // Walk up the DOM tree from anchor
  while (current && current !== document.body && current !== document.documentElement) {
    const parent: Element | null = current.parentElement;
    if (parent && !visitedParents.has(parent)) {
      visitedParents.add(parent);

      const children = Array.from(parent.children).filter(
        (c) => c.nodeType === Node.ELEMENT_NODE && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE'
      );

      if (children.length >= 2) {
        // Group children by signature
        const groups = new Map<string, Element[]>();
        for (const child of children) {
          const sig = getElementSignature(child);
          const list = groups.get(sig) ?? [];
          list.push(child);
          groups.set(sig, list);
        }

        // Find largest group containing or matching current
        for (const [_, matchingElements] of groups) {
          if (matchingElements.length >= 2) {
            const selector = generateRepeatedSelector(parent, matchingElements[0]);
            try {
              const matchedAll = Array.from(document.querySelectorAll(selector));
              if (matchedAll.length >= 2) {
                // Avoid duplicate selectors in candidates list
                if (!candidates.some((c) => c.containerSelector === selector)) {
                  candidates.push({
                    containerSelector: selector,
                    count: matchedAll.length,
                    sampleElements: matchedAll.slice(0, 3).map(createCandidateSample),
                  });
                }
              }
            } catch {
              // Ignore invalid selector
            }
          }
        }
      }
    }
    current = current.parentElement;
  }

  // Sort candidates by count (higher repetition first)
  return candidates.sort((a, b) => b.count - a.count);
}

/**
 * Auto-detects repeated list, table, or card patterns across the entire document.
 */
export function autoDetectRepeatedPatterns(root: Document | Element = document): RepeatedPatternCandidate[] {
  const candidates: RepeatedPatternCandidate[] = [];
  const candidateContainers = root.querySelectorAll(
    'ul, ol, tbody, [class*="list" i], [class*="grid" i], [class*="items" i], [class*="cards" i], [class*="results" i], [class*="feed" i]'
  );

  for (const container of Array.from(candidateContainers)) {
    const children = Array.from(container.children).filter(
      (c) => c.nodeType === Node.ELEMENT_NODE && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE'
    );

    if (children.length >= 2) {
      const groups = new Map<string, Element[]>();
      for (const child of children) {
        const sig = getElementSignature(child);
        const list = groups.get(sig) ?? [];
        list.push(child);
        groups.set(sig, list);
      }

      for (const [_, matchingElements] of groups) {
        if (matchingElements.length >= 2) {
          const selector = generateRepeatedSelector(container, matchingElements[0]);
          try {
            const matchedAll = Array.from(document.querySelectorAll(selector));
            if (matchedAll.length >= 2 && !candidates.some((c) => c.containerSelector === selector)) {
              candidates.push({
                containerSelector: selector,
                count: matchedAll.length,
                sampleElements: matchedAll.slice(0, 3).map(createCandidateSample),
              });
            }
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  return candidates.sort((a, b) => b.count - a.count);
}
