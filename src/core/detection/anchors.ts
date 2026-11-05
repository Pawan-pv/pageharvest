import { escapeCss, filterMeaningfulClasses } from '@/utils/selector';
import type { DiscoveredFieldType } from '@/types';
import {
  ElementFingerprint,
  ElementFingerprintSchema,
  ExpectedValueType,
  MultiAnchorSelector,
  normalizeSelectorAnchor,
} from '@/shared/contracts/selector';
import { safeQuery, safeQueryAll } from '@/utils/safe-dom';

export { normalizeSelectorAnchor };

/**
 * Multi-anchor selector construction for the detection engine.
 *
 * For every container and every field that detection proposes, this module
 * captures a three-tier selector ladder plus a structural fingerprint:
 *
 *   Tier 1  semantic selector      stable attributes ([data-testid], [data-id],
 *                                  [itemprop], [role], [aria-label], a[href])
 *   Tier 2  filtered class         class tokens with Tailwind states, arbitrary
 *                                  values and hashed CSS-in-JS names removed
 *   Tier 3  structural path        tag + :nth-of-type() path relative to the
 *                                  repeating container root
 *
 * All generated selectors must be executable without throwing; every evaluation
 * anywhere in the pipeline goes through utils/safe-dom.
 */

const CURRENCY_PREFIX_RE = /^[€£$¥₹±]|\p{Sc}/u;
const LEADING_NUMBER_RE = /^[+-]?\d/;
const TRAILING_DIGIT_UTILITY_RE = /-\d+(?:\.\d+)?$/;
const HEX_HASH_TOKEN_RE = /^[a-f0-9]{6,}$/;
const CSS_IN_JS_HASH_RE = /^(?:css|sc|jss|styled|mui|tw)-[a-z0-9]+$/i;
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * True for class tokens that carry no stable meaning across page generations:
 * Tailwind state variants (`hover:*`), arbitrary values (`bg-[#fff]`), responsive
 * prefixes (`md:flex`), digit-utilities (`grid-cols-3`), raw layout shorthands
 * and hashed CSS-in-JS names (`css-1a2b3c`, handled upstream as well).
 */
export function isEphemeralClass(token: string): boolean {
  if (!token) return false;
  if (token.includes(':') || token.includes('[') || token.includes(']')) return true;
  if (HEX_HASH_TOKEN_RE.test(token) || CSS_IN_JS_HASH_RE.test(token)) return true;
  if (TRAILING_DIGIT_UTILITY_RE.test(token)) return true;
  // Layout/flex/grid shorthand utilities that appear anywhere in a component tree.
  if (
    /^(?:flex|grid|block|inline|relative|absolute|fixed|sticky|overflow|border|rounded|shadow|opacity|z$|transition)/.test(
      token
    )
  ) {
    return true;
  }
  return false;
}

/** Semantic Tier-1 attributes, in the order they should be attempted. */
const SEMANTIC_ATTRS: ReadonlyArray<{ attr: string; build: (value: string) => string }> = [
  { attr: 'data-testid', build: (v) => `[data-testid="${escapeAttrValue(v)}"]` },
  { attr: 'data-id', build: (v) => `[data-id="${escapeAttrValue(v)}"]` },
  { attr: 'itemprop', build: (v) => `[itemprop="${escapeAttrValue(v)}"]` },
  { attr: 'role', build: (v) => `[role="${escapeAttrValue(v)}"]` },
  { attr: 'aria-label', build: (v) => `[aria-label="${escapeAttrValue(v)}"]` },
];

/**
 * Tier 1: the first stable semantic attribute the element carries, otherwise a
 * href-anchored link, otherwise null.
 */
export function buildSemanticSelector(element: Element): string | null {
  for (const { attr, build } of SEMANTIC_ATTRS) {
    const value = element.getAttribute(attr);
    if (value && value.trim()) {
      return build(value.trim());
    }
  }
  const href = element.getAttribute('href');
  if (element.tagName === 'A' && href && href.trim() && !href.startsWith('#') && !href.startsWith('javascript:')) {
    return `a[href="${escapeAttrValue(href.trim())}"]`;
  }
  return null;
}

/**
 * Tier 2: scoped class selector built only from tokens that mean the same thing
 * on another generation of the page. Null when the element has none.
 */
export function buildFilteredClassSelector(element: Element): string | null {
  const tokens = filterMeaningfulClasses(element.classList).filter((token) => !isEphemeralClass(token));
  if (tokens.length === 0) return null;
  const tag = element.tagName.toLowerCase();
  return `${tag}.${tokens.map(escapeCss).join('.')}`;
}

/**
 * Tier 3: a relative structural path (tags + :nth-of-type positions) from the
 * repeating container down to the element. Returns null when the element is the
 * container itself (`.` means "the container").
 */
export function buildStructuralPath(element: Element, containerRoot: Element): string | null {
  if (containerRoot === element) return '.';

  const segments: string[] = [];
  let current: Element = element;
  while (current !== containerRoot) {
    const parent = current.parentElement;
    if (!parent) return null; // containerRoot is not an ancestor
    const tag = current.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
    const index = sameTag.indexOf(current) + 1;
    segments.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }
  return segments.join(' > ');
}

/**
 * Value type inference used when detection has no explicit type for an element.
 */
export function inferExpectedValueType(element: Element): ExpectedValueType {
  const text = (element.textContent ?? '').trim();
  if (CURRENCY_PREFIX_RE.test(text) || /(?:\d)\s*(?:usd|eur)/i.test(text)) return 'price';
  if (element.tagName === 'IMG' || element.hasAttribute('src') || element.hasAttribute('data-src')) {
    return 'image';
  }
  if (element.tagName === 'A' && (element.hasAttribute('href') || element.hasAttribute('data-href'))) {
    return 'url';
  }
  if (LEADING_NUMBER_RE.test(text)) return 'number';
  return 'text';
}

/** Filtered class tokens of an element, deduplicated. */
function meaningfulClassTokens(element: Element): string[] {
  const tokens: string[] = [];
  for (const token of filterMeaningfulClasses(element.classList)) {
    if (!isEphemeralClass(token) && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/**
 * Structural fingerprint of how an element sits inside its repeating container.
 */
export function buildElementFingerprint(
  element: Element,
  containerRoot: Element,
  override?: Partial<Pick<ElementFingerprint, 'expectedValueType'>>
): ElementFingerprint {
  const depth: number = ((): number => {
    let level = 0;
    let current: Element | null = element;
    while (current && current !== containerRoot) {
      current = current.parentElement;
      level++;
    }
    return current === containerRoot ? level : 0;
  })();

  const parent = element.parentElement;
  const sameTag = parent ? Array.from(parent.children).filter((s) => s.tagName === element.tagName) : [];
  const text = (element.textContent ?? '').trim();
  const ariaRole = element.getAttribute('role') ?? undefined;

  const fingerprint: ElementFingerprint = {
    tagName: element.tagName.toLowerCase(),
    ariaRole: ariaRole ?? undefined,
    relativeDepth: depth,
    siblingIndex: sameTag.indexOf(element) + 1,
    expectedValueType: override?.expectedValueType ?? inferExpectedValueType(element),
    sampleLengthRange: text
      ? { min: text.length, max: text.length }
      : undefined,
    commonClassTokens: meaningfulClassTokens(element),
  };
  return ElementFingerprintSchema.parse(fingerprint);
}

/**
 * Similarity between two fingerprints, 0..1. Tag name is disqualified aggressively
 * (a healed field that starts matching the wrong tag is worse than no healing).
 * Same-tag matches are compared on value type, depth, sibling position and class
 * token overlap.
 */
export function fingerprintSimilarity(a: ElementFingerprint, b: ElementFingerprint): number {
  if (a.tagName !== b.tagName) return 0;

  let score = 0.35; // matching tag
  score += a.expectedValueType === b.expectedValueType ? 0.25 : 0;

  const depthDelta = Math.abs(a.relativeDepth - b.relativeDepth);
  score += depthDelta === 0 ? 0.15 : depthDelta === 1 ? 0.075 : 0;

  const siblingDelta = Math.abs(a.siblingIndex - b.siblingIndex);
  score += siblingDelta === 0 ? 0.1 : siblingDelta === 1 ? 0.05 : 0;

  const tokensA = new Set(a.commonClassTokens);
  const tokensB = new Set(b.commonClassTokens);
  const union = new Set([...tokensA, ...tokensB]);
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const jaccard = union.size === 0 ? 0.1 : intersection / union.size;
  score += jaccard * 0.15;

  return Math.round(score * 100) / 100;
}

/** Similarity below which a candidate may NOT stand in for a stored fingerprint. */
export const FINGERPRINT_CONTAINER_THRESHOLD = 0.72;
export const FINGERPRINT_FIELD_THRESHOLD = 0.6;

/**
 * Assembles a MultiAnchorSelector straight from the DOM, preserving the caller's
 * already-known primary selector as Tier 1.
 */
export function buildContainerAnchor(
  container: Element,
  item: Element,
  primary: string
): MultiAnchorSelector | null {
  const normalized = normalizeSelectorAnchor(primary);
  if (!normalized) return null;
  return {
    primary,
    fallbackClass: buildFilteredClassSelector(item) ?? undefined,
    structuralPath: buildStructuralPath(item, container) ?? undefined,
    fingerprint: buildElementFingerprint(item, container),
  };
}

/** Heals a raw selector by scoring candidate descendants against a fingerprint. */
export function bestFingerprintMatch(
  container: Element,
  fingerprint: ElementFingerprint,
  candidates: Element[],
  threshold: number = FINGERPRINT_FIELD_THRESHOLD
): Element | null {
  let best: { element: Element; score: number } | null = null;
  for (const candidate of candidates) {
    const built = buildElementFingerprint(candidate, container);
    built.expectedValueType = fingerprint.expectedValueType; // trust the stored intent
    const score = fingerprintSimilarity(fingerprint, built);
    if (score >= threshold && (!best || score > best.score)) {
      best = { element: candidate, score };
    }
  }
  return best?.element ?? null;
}

/**
 * Finds the repeating items of a vanished list again. The ladders mirror the
 * field ladder: the filtered class selector first, then structural fingerprints
 * grouped by parent (the stored fingerprint describes an item inside its list
 * parent, so a parent with several near-kin candidates is the strongest signal).
 * Returns an empty list when nothing on the page stands in for the items.
 */
export function recoverContainerItems(
  root: Document | Element,
  anchor: MultiAnchorSelector | null | undefined
): Element[] {
  if (!anchor) return [];
  if (anchor.fallbackClass) {
    const byClass = safeQueryAll(root, anchor.fallbackClass);
    if (byClass.length > 0) return byClass;
  }
  const fingerprint = anchor.fingerprint;
  if (!fingerprint || !fingerprint.tagName) return [];

  const candidates = safeQueryAll(root, fingerprint.tagName).slice(0, 500);
  if (candidates.length === 0) return [];

  const byParent = new Map<Element, Element[]>();
  for (const candidate of candidates) {
    const parent = candidate.parentElement ?? (root as Element);
    const group = byParent.get(parent);
    if (group) group.push(candidate);
    else byParent.set(parent, [candidate]);
  }

  let bestGroup: Element[] = [];
  for (const members of byParent.values()) {
    if (members.length < Math.max(2, bestGroup.length)) continue;
    const similar = members.filter((member) => {
      const built = buildElementFingerprint(member, member.parentElement ?? members[0]);
      built.expectedValueType = fingerprint.expectedValueType;
      return fingerprintSimilarity(fingerprint, built) >= FINGERPRINT_CONTAINER_THRESHOLD;
    });
    if (similar.length > bestGroup.length) {
      bestGroup = similar;
    }
  }
  return bestGroup;
}

export function resolveAnchorSelector(
  root: Document | Element,
  anchor: MultiAnchorSelector | null | undefined
): Element[] {
  if (!anchor?.primary) return [];
  if (!safeQuery(root, anchor.primary)) return [];
  return safeQueryAll(root, anchor.primary);
}

/**
 * Detection value kinds map onto fingerprint value kinds used during healing.
 * Exported for the extraction engine, which re-types fingerprint matches.
 */
export function expectedValueTypeOfKind(type: DiscoveredFieldType | string): ExpectedValueType {
  switch (type) {
    case 'link':
      return 'url';
    case 'image':
      return 'image';
    case 'price':
      return 'price';
    case 'rating':
      return 'number';
    default:
      return 'text';
  }
}

/**
 * Builds the three-tier ladder + fingerprint for one field, anchored on one
 * representative repeating item and the element its selector resolves to.
 */
export function buildFieldAnchor(
  item: Element,
  target: Element,
  selector: string,
  type: DiscoveredFieldType | string
): MultiAnchorSelector {
  const structuralPath = target === item ? '.' : buildStructuralPath(target, item);
  return {
    primary: selector,
    fallbackClass: buildFilteredClassSelector(target) ?? undefined,
    structuralPath: structuralPath ?? undefined,
    fingerprint: buildElementFingerprint(target, item, {
      expectedValueType: expectedValueTypeOfKind(type),
    }),
  };
}

/**
 * Attaches per-field anchors to a final selection. Built exactly once, on the
 * already-chosen list (never inside detection evaluation loops), keeping the
 * detection hot path free of fingerprint work.
 */
export function attachFieldAnchors<T extends { selector: string; type: string }>(
  fields: T[],
  sampleItem: Element
): Array<T & { anchor: MultiAnchorSelector | undefined }> {
  return fields.map((field) => {
    const resolved =
      field.selector && field.selector !== '.' && field.selector !== ':scope'
        ? safeQuery(sampleItem, field.selector)
        : sampleItem;
    const target = resolved ?? sampleItem;
    return { ...field, anchor: buildFieldAnchor(sampleItem, target, field.selector, field.type) };
  });
}
