import {
  DetectedListResult,
  DetectionOptions,
  DiscoveredField,
  CandidateSample,
} from '@/types/detection';
import { getBoundedAncestry, sampleElements } from './cache';
import { calculateTreeSimilarity, clusterSiblings } from './similarity';
import { calculateConfidence } from './confidence';
import { discoverFieldsInCluster } from './fields';
import { generateRepeatedSelector, createCandidateSample } from './repeated';
import {
  escapeCss,
  filterMeaningfulClasses,
  getDurableAttributeSelector,
  isDynamicId,
  isUniqueId,
} from '@/utils/selector';
import { attachFieldAnchors, buildContainerAnchor } from './anchors';

/**
 * Fast selector generator for a parent container avoiding duplicate IDs.
 */
function getFastParentSelector(parent: Element, root: Document | Element = parent.ownerDocument ?? document): string {
  if (parent.id && !isDynamicId(parent.id) && isUniqueId(parent.id, root)) {
    return `#${escapeCss(parent.id)}`;
  }
  const tag = parent.tagName.toLowerCase();
  const attr = getDurableAttributeSelector(parent);
  if (attr) {
    return `${tag}${attr}`;
  }
  const meaningful = filterMeaningfulClasses(parent.classList);
  if (meaningful.length > 0) {
    return `${tag}.${meaningful.map(escapeCss).join('.')}`;
  }
  return tag;
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
  const parentClass = (parent.getAttribute('class') ?? '').toLowerCase();
  const itemClass = (rep.getAttribute('class') ?? '').toLowerCase();

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

function buildDetectedListResult(
  matchedElements: Element[],
  parent: Element,
  itemSelector: string,
  fields: DiscoveredField[],
  confidence: number,
  confidencePercent: number,
  confidenceFactors: import('@/types/detection').ConfidenceFactors,
  sampleLimit: number,
  evidence: string[]
): DetectedListResult {
  const parentSel = getFastParentSelector(parent, matchedElements[0].ownerDocument ?? document);
  const listName = inferListName(matchedElements, parent, fields);
  const samples: CandidateSample[] = sampleElements(matchedElements, sampleLimit).map(
    createCandidateSample
  );

  return {
    name: listName,
    containerSelector: itemSelector,
    containerAnchor:
      buildContainerAnchor(matchedElements[0].parentElement ?? parent, matchedElements[0], itemSelector) ??
      undefined,
    parentSelector: parentSel,
    itemSelector,
    itemCount: matchedElements.length,
    confidence,
    confidencePercent,
    confidenceFactors,
    availableFields: attachFieldAnchors(fields, matchedElements[0]),
    sampleElements: samples,
    matchedElements,
    credible: true,
    evidence,
  };
}

/**
 * Builds a DetectedListResult directly from an explicit list of >= 2 matched DOM elements
 * when pattern clustering did not emit a structural list (e.g., heterogeneous user selection).
 */
export function buildDetectedListFromMatchedElements(
  elements: Element[],
  selector: string,
  options?: DetectionOptions
): DetectedListResult | null {
  if (elements.length < (options?.minItems ?? 2)) return null;
  const parent = elements[0].parentElement ?? elements[0].ownerDocument?.body ?? elements[0];
  const fields = discoverFieldsInCluster(elements, options?.heuristics);
  const { confidence, confidencePercent, factors } = calculateConfidence({
    items: elements,
    parent,
    discoveredFields: fields,
    totalSiblingCount: Math.max(elements.length, parent.children.length),
  });
  return buildDetectedListResult(
    elements,
    parent,
    selector,
    fields,
    Math.max(confidence, 0.35),
    Math.max(confidencePercent, 35),
    factors,
    options?.sampleLimit ?? 5,
    ['matched your selection']
  );
}

/**
 * Builds a semantic or structural selector for a repeating container wrapper that may appear
 * multiple times (e.g., chunked infinite-scroll blocks or row wrappers). Returns null if the
 * container has no semantic class or durable attribute to identify it across chunks.
 */
function getGeneralizedWrapperSelector(container: Element): string | null {
  const tag = container.tagName.toLowerCase();
  const attr = getDurableAttributeSelector(container);
  if (attr) return `${tag}${attr}`;
  const classes = filterMeaningfulClasses(container.classList);
  if (classes.length > 0) {
    return `${tag}.${classes.slice(0, 2).map(escapeCss).join('.')}`;
  }
  return null;
}

/**
 * Expands a repeated item cluster across structurally matching sibling/same-region containers
 * (e.g., infinite-scroll grid chunks or row-wrapped cards) while staying inside the same region.
 */
function expandAcrossMatchingContainers(
  candidateParent: Element,
  targetCluster: Element[],
  searchRoot: Document
): { containers: Element[]; items: Element[] } {
  const singleResult = { containers: [candidateParent], items: targetCluster };
  if (targetCluster.length === 0) return singleResult;

  const repItem = targetCluster[0];
  const mainRegion = candidateParent.closest('main, [role="main"]');
  const parentOfContainer = candidateParent.parentElement;
  const wrapperSelector = getGeneralizedWrapperSelector(candidateParent);
  const isNavSource = isInNavigationRegion(candidateParent);
  const isSecondarySource = isSecondaryContent(candidateParent);

  let matchingWrappers: Element[] = [];
  if (wrapperSelector) {
    try {
      matchingWrappers = Array.from(searchRoot.querySelectorAll(wrapperSelector)).filter((el) => {
        if (el === candidateParent) return true;
        if (mainRegion && !mainRegion.contains(el)) return false;
        if (!mainRegion && el.closest('main, [role="main"]') !== null) return false;
        if (!isNavSource && isInNavigationRegion(el)) return false;
        if (!isSecondarySource && isSecondaryContent(el)) return false;
        return true;
      });
    } catch {
      matchingWrappers = [];
    }
  } else if (parentOfContainer) {
    // Classless wrappers (e.g. row divs) only aggregate with siblings under the same parent
    matchingWrappers = Array.from(parentOfContainer.children).filter(
      (el) => el.tagName === candidateParent.tagName
    );
  }

  if (matchingWrappers.length <= 1) return singleResult;

  const aggregatedContainers: Element[] = [];
  const aggregatedItems: Element[] = [];

  for (const wrapper of matchingWrappers) {
    const clusters = clusterSiblings(wrapper, repItem);
    const matchingCluster = clusters.find(
      (c) => c.length > 0 && calculateTreeSimilarity(c[0], repItem) >= 0.65
    );
    if (matchingCluster && matchingCluster.length > 0) {
      aggregatedContainers.push(wrapper);
      aggregatedItems.push(...matchingCluster);
    }
  }

  if (aggregatedItems.length > targetCluster.length && aggregatedContainers.length > 1) {
    return { containers: aggregatedContainers, items: aggregatedItems };
  }
  return singleResult;
}

/**
 * True when an element acts purely as a layout/chunk wrapper around an inner repeating rich list
 * (e.g. an outer grid chunk or row container with >= 80% of its text inside inner repeating cards).
 */
function isLayoutOrChunkWrapper(sampleItem: Element, heuristics?: DetectionOptions['heuristics']): boolean {
  const totalTextLen = (sampleItem.textContent ?? '').trim().length;
  if (totalTextLen === 0) return false;

  const queue: Array<{ el: Element; depth: number }> = [{ el: sampleItem, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.el.children.length >= 2 && !SKIPPED_PARENT_TAGS.has(current.el.tagName)) {
      for (const cluster of clusterSiblings(current.el)) {
        if (cluster.length < 2 || NON_RECORD_TAGS.has(cluster[0].tagName)) continue;
        const innerFields = discoverFieldsInCluster(cluster, heuristics, { sampleSize: 4 });
        const innerTypes = new Set(innerFields.filter((f) => f.coverage >= 0.5).map((f) => f.type));
        const hasRichFields =
          innerFields.filter((f) => f.coverage >= 0.5).length >= 2 ||
          innerTypes.has('price') ||
          innerTypes.has('link');
        if (!hasRichFields) continue;

        const innerTextLen = cluster.reduce(
          (sum, child) => sum + (child.textContent ?? '').trim().length,
          0
        );
        if (innerTextLen / totalTextLen >= 0.8) {
          return true;
        }
      }
    }
    if (current.depth < 2) {
      for (const child of Array.from(current.el.children)) {
        if (!SKIPPED_PARENT_TAGS.has(child.tagName)) {
          queue.push({ el: child, depth: current.depth + 1 });
        }
      }
    }
  }
  return false;
}

/**
 * Core Algorithm: Bidirectional (Walk-Up + Drill-Down) + Cross-Container list detection
 * starting from any hovered or clicked element context.
 */
export function detectListFromSelection(
  targetElement: Element,
  options?: DetectionOptions
): DetectedListResult | null {
  const maxDepth = options?.maxDepth ?? 8;
  const minItems = options?.minItems ?? 2;
  const minConfidence = options?.minConfidence ?? 0.35;
  const sampleLimit = options?.sampleLimit ?? 5;
  const searchRoot = targetElement.ownerDocument ?? document;

  interface CandidateEvaluation {
    itemSelector: string;
    containerSelector: string;
    parentSelector: string;
    matchedElements: Element[];
    containers: Element[];
    parent: Element;
    fields: DiscoveredField[];
    confidence: number;
    confidencePercent: number;
    factors: import('@/types/detection').ConfidenceFactors;
    depthDistance: number;
    score: number;
  }

  const evaluations: CandidateEvaluation[] = [];
  const seenClusterKeys = new Set<string>();

  const evaluateCluster = (
    parent: Element,
    cluster: Element[],
    depthDistance: number,
    direction: 'walk_up' | 'drill_down'
  ) => {
    if (cluster.length < minItems || NON_RECORD_TAGS.has(cluster[0].tagName)) return;

    const expanded = expandAcrossMatchingContainers(parent, cluster, searchRoot);
    const matchedElements = expanded.items;
    if (matchedElements.length < minItems) return;

    const dedupeKey = `${matchedElements[0].tagName}:${matchedElements.length}:${getFastParentSelector(parent, searchRoot)}`;
    if (seenClusterKeys.has(dedupeKey) && evaluations.some((e) => e.matchedElements[0] === matchedElements[0] && e.matchedElements.length === matchedElements.length)) {
      return;
    }
    seenClusterKeys.add(dedupeKey);

    const fields = discoverFieldsInCluster(matchedElements, options?.heuristics);
    const { confidence, confidencePercent, factors } = calculateConfidence({
      items: matchedElements,
      parent,
      discoveredFields: fields,
      totalSiblingCount: parent.children.length,
    });

    if (confidence < minConfidence) return;

    const parentSel = getFastParentSelector(parent, searchRoot);
    const repeatedSelector = generateRepeatedSelector(parent, matchedElements[0]);

    const meaningfulColumns = fields.filter((f) => f.coverage >= 0.5).length;
    const richnessBonus =
      meaningfulColumns >= 3 ? 1.2 : meaningfulColumns === 2 ? 1.05 : meaningfulColumns === 1 ? 0.85 : 0.65;
    const wrapsInner = isLayoutOrChunkWrapper(matchedElements[0], options?.heuristics);
    const wrapperPenalty = wrapsInner ? 0.25 : 1.0;
    const proximityBonus = direction === 'walk_up' ? 1 / (1 + depthDistance * 0.12) : 1 / (1 + depthDistance * 0.08);
    const score =
      confidence *
      Math.log2(matchedElements.length + 1) *
      richnessBonus *
      proximityBonus *
      wrapperPenalty;

    evaluations.push({
      itemSelector: repeatedSelector,
      containerSelector: repeatedSelector,
      parentSelector: parentSel,
      matchedElements,
      containers: expanded.containers,
      parent,
      fields,
      confidence,
      confidencePercent,
      factors,
      depthDistance,
      score,
    });
  };

  // 1. Walk-Up Search along bounded ancestry
  const ancestry = getBoundedAncestry(targetElement, maxDepth);
  for (let d = 0; d < ancestry.length; d++) {
    const candidateItem = ancestry[d];
    const candidateParent = candidateItem.parentElement;
    if (!candidateParent || SKIPPED_PARENT_TAGS.has(candidateParent.tagName)) continue;

    const clusters = clusterSiblings(candidateParent, candidateItem);
    const targetCluster = clusters.find((c) => c.includes(candidateItem));
    if (targetCluster && targetCluster.length >= minItems) {
      evaluateCluster(candidateParent, targetCluster, d, 'walk_up');
    }
  }

  // 2. Drill-Down Search inside targetElement (depth 0..4) for wrapper/chunk selections
  const bfsQueue: Array<{ el: Element; depth: number }> = [{ el: targetElement, depth: 0 }];
  let scannedDrillNodes = 0;
  const MAX_DRILL_NODES = 60;
  while (bfsQueue.length > 0 && scannedDrillNodes < MAX_DRILL_NODES) {
    const { el, depth } = bfsQueue.shift()!;
    scannedDrillNodes++;

    if (el.children.length >= minItems && !SKIPPED_PARENT_TAGS.has(el.tagName) && !el.closest('svg')) {
      for (const cluster of clusterSiblings(el)) {
        evaluateCluster(el, cluster, depth, 'drill_down');
      }
    }

    if (depth < 4) {
      for (const child of Array.from(el.children)) {
        if (!SKIPPED_PARENT_TAGS.has(child.tagName)) {
          bfsQueue.push({ el: child, depth: depth + 1 });
        }
      }
    }
  }

  if (evaluations.length === 0) return null;

  evaluations.sort((a, b) => b.score - a.score);
  const best = evaluations[0];

  // What is shown and what is extracted come from one selector, so they cannot differ.
  const itemSelector = scopeItemSelector(
    { parent: best.parent, containers: best.containers, items: best.matchedElements, required: minItems },
    searchRoot
  );
  let matchedElements: Element[];
  try {
    matchedElements = Array.from(searchRoot.querySelectorAll(itemSelector));
  } catch {
    matchedElements = best.matchedElements;
  }
  if (matchedElements.length === 0) {
    matchedElements = best.matchedElements;
  }
  const listName = inferListName(matchedElements, best.parent, best.fields);
  const samples: CandidateSample[] = sampleElements(matchedElements, sampleLimit).map(
    createCandidateSample
  );

  return {
    name: listName,
    containerSelector: itemSelector,
    containerAnchor: buildContainerAnchor(
      matchedElements[0].parentElement ?? best.parent,
      matchedElements[0],
      itemSelector
    ) ?? undefined,
    parentSelector: best.parentSelector,
    itemSelector,
    itemCount: matchedElements.length,
    confidence: best.confidence,
    confidencePercent: best.confidencePercent,
    confidenceFactors: best.factors,
    availableFields: attachFieldAnchors(best.fields, matchedElements[0]),
    sampleElements: samples,
    matchedElements,
    credible: true,
    evidence: ['chosen on the page'],
  };
}

/**
 * Finds the lists on a page, best first. The confidence is an assessment of whether a list
 * is data, built only from the observations listed in its evidence: see assessGroup. The
 * caller shows the alternatives, because the best guess can still be wrong.
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
  const hasMain = root.querySelector('main, [role="main"]') !== null;

  const ranked = groups
    .map((group) => {
      const fields = discoverFieldsInCluster(group.items, options?.heuristics, {
        sampleSize: RANKING_FIELD_SAMPLE,
      });
      const { confidence: structural, factors } = calculateConfidence({
        items: group.items,
        parent: group.parent,
        discoveredFields: fields,
        totalSiblingCount: group.parent.children.length,
      });
      const assessment = assessGroup(group, fields, structural, allParents, hasMain);
      return {
        group,
        factors,
        structural,
        ...assessment,
        score: assessment.confidence * Math.log2(group.items.length + 1),
      };
    })
    .filter((candidate) => candidate.structural >= minConfidence)
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

    const fields = discoverFieldsInCluster(matchedElements, options?.heuristics);
    results.push({
      name: inferListName(matchedElements, group.parent, fields),
      containerSelector: itemSelector,
      containerAnchor:
        buildContainerAnchor(
          matchedElements[0].parentElement ?? group.parent,
          matchedElements[0],
          itemSelector
        ) ?? undefined,
      parentSelector: getFastParentSelector(group.parent, root),
      itemSelector,
      itemCount: matchedElements.length,
      confidence: candidate.confidence,
      confidencePercent: Math.round(candidate.confidence * 100),
      confidenceFactors: candidate.factors,
      availableFields: attachFieldAnchors(fields, matchedElements[0]),
      sampleElements: sampleElements(matchedElements, sampleLimit).map(createCandidateSample),
      matchedElements,
      credible: candidate.credible,
      evidence: candidate.evidence,
    });
  }

  return results;
}

interface RepeatedGroup {
  parent: Element;
  containers?: Element[];
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

/** What a block calling itself one of these is saying: this is not the page's main list. */
const SECONDARY_CONTENT =
  /(?:^|[\s_-])(?:carousel|slider|swiper|recommend(?:ed|ations?)?|related|sponsored|promo(?:tions?|ted)?|similar|upsell|cross-?sell|trending|ads?|adverts?|advertisements?)(?:$|[\s_-])/i;
const SECONDARY_HEADING = /you (?:may|might) also|recommended|related|similar|sponsored|people also|customers also/i;

const MAX_SCANNED_ELEMENTS = 20000;
const MAX_EVALUATED_GROUPS = 150;
const MAX_AUTO_DETECTED_LISTS = 8;
const MIN_ITEMS_OUTSIDE_LIST_CONTAINER = 3;
const MAX_SCOPE_DEPTH = 6;
const RANKING_FIELD_SAMPLE = 4;
const NAVIGATION_WEIGHT = 0.2;
const WRAPPER_WEIGHT = 0.5;
const SECONDARY_WEIGHT = 0.45;
const OUTSIDE_MAIN_WEIGHT = 0.75;
const ONLY_LINKS_WEIGHT = 0.6;
/** Below this a list is shown only as a low-ranked alternative. */
const MIN_CREDIBLE_CONFIDENCE = 0.2;

/**
 * Every parent on the page with repeated children is a candidate. Class names are not
 * required, because plenty of real lists are plain divs in a layout column.
 */
function findRepeatedGroups(root: Document | Element, minItems: number): RepeatedGroup[] {
  const scope = 'body' in root ? root.body ?? root.documentElement : root;
  const elements = [scope, ...Array.from(scope.querySelectorAll('*')).slice(0, MAX_SCANNED_ELEMENTS)];
  // Rows of a grid or chunked infinite-scroll blocks with identical semantic wrappers are one list.
  const merged = new Map<Element | null, Map<string, RepeatedGroup>>();

  for (const parent of elements) {
    if (parent.children.length < 2 || SKIPPED_PARENT_TAGS.has(parent.tagName) || parent.closest('svg')) continue;
    const required = parent.matches(LIST_LIKE_CONTAINER)
      ? minItems
      : Math.max(minItems, MIN_ITEMS_OUTSIDE_LIST_CONTAINER);

    const wrapperSel = getGeneralizedWrapperSelector(parent);
    const isSemanticChunkWrapper =
      wrapperSel !== null &&
      !isInNavigationRegion(parent) &&
      !isSecondaryContent(parent) &&
      (parent.matches(LIST_LIKE_CONTAINER) || getDurableAttributeSelector(parent) !== null);

    for (const items of clusterSiblings(parent)) {
      if (items.length < minItems || NON_RECORD_TAGS.has(items[0].tagName)) continue;
      const regionKey: Element | null =
        isSemanticChunkWrapper && items.length >= required
          ? (parent.closest('main, [role="main"]') ?? scope)
          : parent.parentElement;
      const key = generateRepeatedSelector(parent, items[0]);
      const siblings = merged.get(regionKey) ?? new Map<string, RepeatedGroup>();
      merged.set(regionKey, siblings);
      const existing = siblings.get(key);
      if (existing) {
        if (
          existing.items.length > 0 &&
          calculateTreeSimilarity(existing.items[0], items[0]) >= 0.65
        ) {
          existing.containers = existing.containers ?? [existing.parent];
          existing.containers.push(parent);
          existing.items.push(...items);
        }
      } else {
        siblings.set(key, { parent, containers: [parent], items: [...items], required });
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

function isSecondaryContent(element: Element): boolean {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 4 && current.tagName !== 'BODY'; depth++) {
    const label = [current.getAttribute('class'), current.id, current.getAttribute('aria-label')].join(' ');
    if (SECONDARY_CONTENT.test(label)) return true;
    const heading = current.previousElementSibling;
    if (heading && /^H[1-6]$/.test(heading.tagName) && SECONDARY_HEADING.test(heading.textContent ?? '')) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * How likely a repeated group is to be data the user wants. It starts from how alike the
 * items are, and each observation below adjusts it and is recorded as evidence.
 */
function assessGroup(
  group: RepeatedGroup,
  fields: DiscoveredField[],
  structural: number,
  allParents: Element[],
  hasMain: boolean
): { confidence: number; credible: boolean; evidence: string[] } {
  const evidence = [`${group.items.length} similar items`];
  const kinds = new Set(fields.filter((field) => field.coverage >= 0.5).map((field) => field.type)).size;
  const columns = fields.filter((field) => field.coverage >= 0.5).length;
  let weight = kinds >= 3 || columns >= 3 ? 1 : kinds === 2 || columns === 2 ? 0.8 : kinds === 1 ? 0.5 : 0.3;
  evidence.push(`${columns} consistent ${columns === 1 ? 'value' : 'values'} per item`);

  let textLength = 0;
  let linkTextLength = 0;
  for (const item of sampleElements(group.items, 8)) {
    textLength += (item.textContent ?? '').trim().length;
    for (const link of Array.from(item.querySelectorAll('a'))) {
      linkTextLength += (link.textContent ?? '').trim().length;
    }
  }
  if (textLength > 0 && linkTextLength / textLength >= 0.9 && kinds <= 1) {
    weight *= ONLY_LINKS_WEIGHT;
    evidence.push('each item is only a link');
  }

  const inNavigation = isInNavigationRegion(group.parent);
  if (inNavigation) {
    weight *= NAVIGATION_WEIGHT;
    evidence.push('inside navigation, a sidebar or a footer');
  }
  if (isSecondaryContent(group.parent)) {
    weight *= SECONDARY_WEIGHT;
    evidence.push('labelled as recommendations or promotions');
  }
  if (wrapsAnotherGroup(group.items, allParents)) {
    weight *= WRAPPER_WEIGHT;
    evidence.push('each item contains another list');
  }
  if (hasMain) {
    if (group.parent.closest('main, [role="main"]')) {
      evidence.push('in the main content');
    } else {
      weight *= OUTSIDE_MAIN_WEIGHT;
      evidence.push('outside the main content');
    }
  }

  const confidence = Math.round(structural * weight * 100) / 100;
  return { confidence, credible: !inNavigation && confidence >= MIN_CREDIBLE_CONFIDENCE, evidence };
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
function structuralParentPath(parent: Element, root: Document | Element = parent.ownerDocument ?? document): string {
  const parts: string[] = [];
  let current: Element | null = parent;
  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    if (current.id && !isDynamicId(current.id) && isUniqueId(current.id, root)) {
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

function commonAncestorOf(elements: Element[]): Element | null {
  if (elements.length === 0) return null;
  let ancestor: Element | null = elements[0].parentElement;
  while (ancestor) {
    if (elements.every((el) => ancestor!.contains(el))) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

/**
 * Extraction uses this selector on every page of the job, so it must match this list and
 * not the same tags elsewhere, such as `ul > li` also matching the site menu.
 */
function scopeItemSelector(group: RepeatedGroup, root: Document | Element): string {
  const { parent, containers, items } = group;
  const tag = items[0].tagName.toLowerCase();
  const base = generateRepeatedSelector(parent, items[0]);
  const parentSelector = base.includes(' > ') ? base.slice(0, base.lastIndexOf(' > ')) : '';
  const tagOnly = parentSelector ? `${parentSelector} > ${tag}` : tag;

  const wantedSet = new Set(items);
  const candidatesToTry = [base, tagOnly];

  // If `base` matches extra non-item siblings inside the container (e.g. injected promo banners),
  // try excluding their distinctive classes with :not(...)
  try {
    const baseMatched = Array.from(root.querySelectorAll(base));
    const activeContainers = new Set(containers && containers.length > 0 ? containers : [parent]);
    const extrasInContainer = baseMatched.filter(
      (el) => !wantedSet.has(el) && el.parentElement !== null && activeContainers.has(el.parentElement)
    );
    if (extrasInContainer.length > 0) {
      const itemClassSet = new Set(filterMeaningfulClasses(items[0].classList));
      const extraClasses = new Set<string>();
      for (const extra of extrasInContainer) {
        for (const cls of filterMeaningfulClasses(extra.classList)) {
          if (!itemClassSet.has(cls)) extraClasses.add(cls);
        }
      }
      if (extraClasses.size > 0) {
        const notClause = Array.from(extraClasses)
          .slice(0, 3)
          .map((cls) => `:not(.${escapeCss(cls)})`)
          .join('');
        candidatesToTry.unshift(`${base}${notClause}`);
      }
    }
  } catch {
    // Ignore invalid selector check
  }

  const covering = candidatesToTry.find((sel) => {
    try {
      const matched = new Set(Array.from(root.querySelectorAll(sel)));
      return items.every((item) => matched.has(item));
    } catch {
      return false;
    }
  });
  const selector = covering ?? base;

  if (matchesExactly(selector, root, items)) return selector;

  const isMultiContainer = Boolean(containers && containers.length > 1);
  let scoped = selector;
  let ancestor = isMultiContainer ? commonAncestorOf(containers!) : parent.parentElement;
  for (let depth = 0; ancestor && ancestor.tagName !== 'BODY' && depth < MAX_SCOPE_DEPTH; depth++) {
    const ancestorSel = getFastParentSelector(ancestor, root);
    const candidateScoped = `${ancestorSel} ${scoped}`;
    if (matchesExactly(candidateScoped, root, items)) return candidateScoped;
    scoped = candidateScoped;
    ancestor = ancestor.parentElement;
  }

  if (!isMultiContainer) {
    const lastStep = selector.includes(' > ') ? selector.slice(selector.lastIndexOf(' > ') + 3) : selector;
    const structural = `${structuralParentPath(parent, root)} > ${lastStep}`;
    return matchesExactly(structural, root, items) ? structural : selector;
  }

  const shared = commonAncestorOf(containers!);
  if (shared) {
    const structuralMulti = `${structuralParentPath(shared, root)} ${selector}`;
    if (matchesExactly(structuralMulti, root, items)) return structuralMulti;
  }
  return selector;
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
