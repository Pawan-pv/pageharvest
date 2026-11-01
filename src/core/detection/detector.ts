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
import { escapeCss, filterMeaningfulClasses, isDynamicId } from '@/utils/selector';

/**
 * Fast selector generator for a parent container avoiding expensive document-wide scans
 */
function getFastParentSelector(parent: Element): string {
  if (parent.id && !isDynamicId(parent.id)) {
    return `#${escapeCss(parent.id)}`;
  }
  const meaningful = filterMeaningfulClasses(parent.classList);
  if (meaningful.length > 0) {
    return `${parent.tagName.toLowerCase()}.${meaningful.map(escapeCss).join('.')}`;
  }
  return parent.tagName.toLowerCase();
}

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
      let matchedElements: Element[] = targetCluster;

      // Only search document if the local cluster has very few items and parent is small
      if (targetCluster.length < 5 && candidateParent.children.length < 50) {
        try {
          const docMatches = Array.from(document.querySelectorAll(repeatedSelector));
          if (docMatches.length >= targetCluster.length) {
            matchedElements = docMatches;
          }
        } catch {
          matchedElements = targetCluster;
        }
      }

      const containsTarget = targetCluster.includes(candidateItem);

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
          const parentSel = getFastParentSelector(candidateParent);

          // Scoring weights confidence, item count, and proximity to clicked element
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

          // Early exit if high-confidence repeating cluster found
          if (matchedElements.length >= 10 && confidence >= 0.70) {
            break;
          }
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
  const minItems = options?.minItems ?? 2;
  const minConfidence = options?.minConfidence ?? 0.35;
  const sampleLimit = options?.sampleLimit ?? 5;

  const groups = findRepeatedGroups(root, minItems);
  const allParents = groups.filter((group) => group.items.length >= 3).map((group) => group.parent);

  const ranked = groups
    .map((group) => {
      const fields = discoverFieldsInCluster(group.items, options?.heuristics);
      const { confidence, confidencePercent, factors } = calculateConfidence({
        items: group.items,
        parent: group.parent,
        discoveredFields: fields,
        totalSiblingCount: group.parent.children.length,
      });
      const score =
        confidence *
        Math.log2(group.items.length + 1) *
        contentWeight(group.items, fields) *
        (isInNavigationRegion(group.parent) ? NAVIGATION_WEIGHT : 1) *
        (wrapsAnotherGroup(group.items, allParents) ? WRAPPER_WEIGHT : 1);
      return { group, fields, confidence, confidencePercent, factors, score };
    })
    .filter((candidate) => candidate.confidence >= minConfidence)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_AUTO_DETECTED_LISTS);

  const results: DetectedListResult[] = [];
  const seenSelectors = new Set<string>();

  for (const candidate of ranked) {
    const { group } = candidate;
    const itemSelector = scopeItemSelector(group, root);
    if (seenSelectors.has(itemSelector)) continue;
    seenSelectors.add(itemSelector);

    // The count shown to the user must be the count the extraction will find.
    const matchedElements = Array.from(root.querySelectorAll(itemSelector));
    if (matchedElements.length < minItems) continue;

    results.push({
      name: inferListName(matchedElements, group.parent, candidate.fields),
      containerSelector: itemSelector,
      parentSelector: getFastParentSelector(group.parent),
      itemSelector,
      itemCount: matchedElements.length,
      confidence: candidate.confidence,
      confidencePercent: candidate.confidencePercent,
      confidenceFactors: candidate.factors,
      availableFields: candidate.fields,
      sampleElements: sampleElements(matchedElements, sampleLimit).map(createCandidateSample),
      matchedElements,
    });
  }

  return results;
}

interface RepeatedGroup {
  parent: Element;
  items: Element[];
  /** Fewest items this group needs to count as a list. */
  required: number;
}

const LIST_LIKE_CONTAINER =
  'ul, ol, tbody, [class*="list" i], [class*="grid" i], [class*="items" i], [class*="cards" i], [class*="results" i], [class*="catalog" i], [class*="feed" i], [role="feed"], [role="grid"], [role="table"]';
const NAVIGATION_REGION =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
const NAVIGATION_CLASS =
  /(?:^|[\s_-])(?:nav|navbar|navigation|menu|sidebar|footer|header|breadcrumbs?|pager|pagination|tabs?)(?:$|[\s_-])/i;
/** Repetition that is page structure or prose, not records. */
const NON_RECORD_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'OPTION', 'OPTGROUP', 'INPUT', 'LABEL',
  'META', 'LINK', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SOURCE', 'COL', 'TH', 'TD',
]);
const SKIPPED_PARENT_TAGS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'SELECT', 'NOSCRIPT', 'TEMPLATE']);

const MAX_SCANNED_ELEMENTS = 20000;
const MAX_EVALUATED_GROUPS = 150;
const MAX_AUTO_DETECTED_LISTS = 8;
const MIN_ITEMS_OUTSIDE_LIST_CONTAINER = 3;
const MAX_SCOPE_DEPTH = 6;
const NAVIGATION_WEIGHT = 0.2;
const WRAPPER_WEIGHT = 0.5;

/**
 * Every parent on the page with repeated children is a candidate. Class names are not
 * required, because plenty of real lists are plain divs in a layout column.
 */
function findRepeatedGroups(root: Document | Element, minItems: number): RepeatedGroup[] {
  const scope = 'body' in root ? root.body ?? root.documentElement : root;
  const elements = [scope, ...Array.from(scope.querySelectorAll('*')).slice(0, MAX_SCANNED_ELEMENTS)];
  // Rows of a grid are separate parents with the same items, so they are one list.
  const merged = new Map<Element | null, Map<string, RepeatedGroup>>();

  for (const parent of elements) {
    if (parent.children.length < 2 || SKIPPED_PARENT_TAGS.has(parent.tagName) || parent.closest('svg')) continue;
    const required = parent.matches(LIST_LIKE_CONTAINER)
      ? minItems
      : Math.max(minItems, MIN_ITEMS_OUTSIDE_LIST_CONTAINER);

    for (const items of clusterSiblings(parent)) {
      if (items.length < minItems || NON_RECORD_TAGS.has(items[0].tagName)) continue;
      const key = generateRepeatedSelector(parent, items[0]);
      const siblings = merged.get(parent.parentElement) ?? new Map<string, RepeatedGroup>();
      merged.set(parent.parentElement, siblings);
      const existing = siblings.get(key);
      if (existing) {
        existing.items.push(...items);
      } else {
        siblings.set(key, { parent, items: [...items], required });
      }
    }
  }

  return Array.from(merged.values())
    .flatMap((siblings) => Array.from(siblings.values()))
    .filter((group) => group.items.length >= group.required)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, MAX_EVALUATED_GROUPS);
}

function isInNavigationRegion(element: Element): boolean {
  let current: Element | null = element;
  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    if (current.matches(NAVIGATION_REGION) || NAVIGATION_CLASS.test(current.getAttribute('class') ?? '')) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/** Items that hold another list are page layout around it, not records. */
function wrapsAnotherGroup(items: Element[], parents: Element[]): boolean {
  return parents.some((parent) => items.some((item) => item !== parent && item.contains(parent)));
}

/**
 * How much the items look like records: several kinds of value, and more than a link each.
 */
function contentWeight(items: Element[], fields: DiscoveredField[]): number {
  const kinds = new Set(fields.filter((field) => (field.coverage ?? 0) >= 0.5).map((field) => field.type)).size;
  const richness = kinds >= 3 ? 1 : kinds === 2 ? 0.8 : kinds === 1 ? 0.5 : 0.3;

  let textLength = 0;
  let linkTextLength = 0;
  for (const item of sampleElements(items, 8)) {
    textLength += (item.textContent ?? '').trim().length;
    for (const link of Array.from(item.querySelectorAll('a'))) {
      linkTextLength += (link.textContent ?? '').trim().length;
    }
  }
  const onlyLinks = textLength > 0 && linkTextLength / textLength >= 0.9 && kinds <= 1;
  return onlyLinks ? richness * 0.4 : richness;
}

function matchesExactly(selector: string, root: Document | Element, items: Element[]): boolean {
  try {
    const matched = root.querySelectorAll(selector);
    if (matched.length !== items.length) return false;
    const wanted = new Set(items);
    return Array.from(matched).every((element) => wanted.has(element));
  } catch {
    return false;
  }
}

/** A path from the nearest stable ancestor, for lists nothing else can tell apart. */
function structuralParentPath(parent: Element): string {
  const parts: string[] = [];
  let current: Element | null = parent;
  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    if (current.id && !isDynamicId(current.id)) {
      parts.unshift(`#${escapeCss(current.id)}`);
      return parts.join(' > ');
    }
    const tag: string = current.tagName.toLowerCase();
    const position = Array.from(current.parentElement?.children ?? [])
      .filter((sibling) => sibling.tagName === current?.tagName)
      .indexOf(current);
    parts.unshift(`${tag}:nth-of-type(${position + 1})`);
    current = current.parentElement;
  }
  parts.unshift('body');
  return parts.join(' > ');
}

/**
 * Extraction uses this selector on every page of the job, so it must match this list and
 * not the same tags elsewhere, such as `ul > li` also matching the site menu.
 */
function scopeItemSelector(group: RepeatedGroup, root: Document | Element): string {
  const { parent, items } = group;
  const tag = items[0].tagName.toLowerCase();
  const base = generateRepeatedSelector(parent, items[0]);
  const parentSelector = base.includes(' > ') ? base.slice(0, base.lastIndexOf(' > ')) : '';
  const tagOnly = parentSelector ? `${parentSelector} > ${tag}` : tag;
  const covering = [base, tagOnly].find((selector) => {
    const matched = new Set(Array.from(root.querySelectorAll(selector)));
    return items.every((item) => matched.has(item));
  });
  const selector = covering ?? base;

  if (matchesExactly(selector, root, items)) return selector;

  let scoped = selector;
  let ancestor = parent.parentElement;
  for (let depth = 0; ancestor && ancestor.tagName !== 'BODY' && depth < MAX_SCOPE_DEPTH; depth++) {
    scoped = `${getFastParentSelector(ancestor)} ${scoped}`;
    if (matchesExactly(scoped, root, items)) return scoped;
    ancestor = ancestor.parentElement;
  }

  const lastStep = selector.includes(' > ') ? selector.slice(selector.lastIndexOf(' > ') + 3) : selector;
  const structural = `${structuralParentPath(parent)} > ${lastStep}`;
  return matchesExactly(structural, root, items) ? structural : selector;
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
