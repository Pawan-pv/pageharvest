import {
  DetectedFieldSuggestion,
  DiscoveredField,
  DiscoveredFieldType,
  FieldDefinition,
  FieldHeuristicConfig,
} from '@/types';
import { filterMeaningfulClasses, generateRelativeSelector } from '@/utils/selector';
import { normalizeText, resolveAbsoluteUrl, parseNumberValue } from '@/utils/dom';
import { NumberParseResult, parseNumberDetailed } from '@/utils/number-parser';
import { sampleElements } from './cache';

const TRUNCATED_TEXT_REGEX = /(?:\.{3}|…)$/;
const MAX_PLAIN_TEXT_FIELDS = 4;
const NOT_PLAIN_TEXT_TAGS = new Set(['A', 'BUTTON', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

// Currency regex supporting $, €, £, ¥, ₹, C$, A$, USD, EUR, GBP, INR, etc.
const DEFAULT_PRICE_REGEX = /(?:[$€£¥₹]|C\$|A\$)\s*[-+]?\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:[$€£¥₹]|USD|EUR|GBP|INR)\b/i;

// Rating regex matching "4.5 out of 5", "4.8 / 5", "4.8", "★★★★★", etc.
const DEFAULT_RATING_REGEX = /\b([0-5](?:\.\d{1,2})?)\s*(?:\/|\s*out\s*of)\s*5\b|\b[0-5]\.\d\b|[★☆]{3,5}/i;

// Date regex matching ISO, textual dates, and relative dates
const DEFAULT_DATE_REGEX = /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago|yesterday|today)\b/i;

// Button action regex
const DEFAULT_BUTTON_TEXT_REGEX = /^(add\s+to\s+cart|buy\s+now|apply\s+now|apply|view\s+details|read\s+more|order\s+now|book\s+now|subscribe|learn\s+more|contact|get\s+started)$/i;

export interface InternalFieldCandidate {
  name: string;
  type: DiscoveredFieldType;
  selector: string;
  extractor: 'text' | 'attribute' | 'href' | 'src' | 'html' | 'number' | 'regex';
  attributeName?: string;
  regexPattern?: string;
  regexGroup?: number;
  sampleValue: string;
  element: Element;
}

function describeNumber(parsed: NumberParseResult): string {
  if (parsed.status === 'ok') return String(parsed.value);
  if (parsed.status === 'range') return `${parsed.min} - ${parsed.max}`;
  return normalizeText(parsed.raw);
}

/**
 * Proposes candidates for a single container element.
 */
export function extractCandidatesFromElement(
  container: Element,
  heuristics?: FieldHeuristicConfig
): InternalFieldCandidate[] {
  const candidates: InternalFieldCandidate[] = [];
  const visitedElements = new Set<Element>();

  // Custom heuristics if provided
  if (heuristics?.customRules) {
    for (const rule of heuristics.customRules) {
      for (const sel of rule.selectors) {
        const el = container.querySelector(sel);
        if (el && !visitedElements.has(el)) {
          visitedElements.add(el);
          const rawVal =
            rule.extractor === 'attribute' && rule.attributeName
              ? el.getAttribute(rule.attributeName) || ''
              : normalizeText(el.textContent);
          candidates.push({
            name: rule.name,
            type: rule.type,
            selector: generateRelativeSelector(container, el),
            extractor: rule.extractor,
            attributeName: rule.attributeName,
            sampleValue: rawVal,
            element: el,
          });
          break;
        }
      }
    }
  }

  // 1. Title / Name
  const titleSelectors = heuristics?.titles || [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    '[class*="title" i]', '[class*="name" i]', '[class*="headline" i]',
  ];
  const titleEl = container.querySelector(titleSelectors.join(', '));
  if (titleEl && !visitedElements.has(titleEl)) {
    const text = normalizeText(titleEl.textContent);
    if (text) {
      visitedElements.add(titleEl);
      const fullTitle = findFullTitle(titleEl, text);
      candidates.push(
        fullTitle
          ? {
              name: 'Title',
              type: 'text',
              selector: generateRelativeSelector(container, fullTitle.element),
              extractor: 'attribute',
              attributeName: 'title',
              sampleValue: fullTitle.value.slice(0, 80),
              element: fullTitle.element,
            }
          : {
              name: 'Title',
              type: 'text',
              selector: generateRelativeSelector(container, titleEl),
              extractor: 'text',
              sampleValue: text.slice(0, 80),
              element: titleEl,
            }
      );
    }
  }

  // 2. Link / URL
  const linkSelectors = heuristics?.links || ['a[href]'];
  const linkEl = container.querySelector(linkSelectors.join(', '));
  if (linkEl && !visitedElements.has(linkEl)) {
    const href = linkEl.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      visitedElements.add(linkEl);
      candidates.push({
        name: 'Link',
        type: 'link',
        selector: generateRelativeSelector(container, linkEl),
        extractor: 'href',
        sampleValue: resolveAbsoluteUrl(href),
        element: linkEl,
      });
    }
  }

  // 3. Image / Thumbnail
  const imgSelectors = heuristics?.images || [
    'img[src]', 'img[data-src]', 'picture > source[srcset]', '[style*="background-image"]',
  ];
  const imgEl = container.querySelector(imgSelectors.join(', '));
  if (imgEl && !visitedElements.has(imgEl)) {
    let src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src');
    if (!src && imgEl.hasAttribute('style')) {
      const style = imgEl.getAttribute('style') || '';
      const bgMatch = style.match(/url\(["']?([^"']+)["']?\)/i);
      if (bgMatch) src = bgMatch[1];
    }
    if (src && !src.startsWith('data:image/svg')) {
      visitedElements.add(imgEl);
      candidates.push({
        name: 'Image',
        type: 'image',
        selector: generateRelativeSelector(container, imgEl),
        extractor: 'src',
        sampleValue: resolveAbsoluteUrl(src),
        element: imgEl,
      });
    }
  }

  // 4. Price
  const priceRegex = heuristics?.prices || DEFAULT_PRICE_REGEX;
  const potentialPrices = Array.from(
    container.querySelectorAll('[class*="price" i], [class*="cost" i], [class*="amount" i], [class*="salary" i], span, div')
  );
  for (const el of potentialPrices) {
    if (visitedElements.has(el)) continue;
    if (el.children.length > 2) continue;
    const text = el.textContent || '';
    if (priceRegex.test(text)) {
      const parsed = parseNumberDetailed(normalizeText(text));
      if (parsed.status !== 'invalid') {
        visitedElements.add(el);
        candidates.push({
          name: 'Price',
          type: 'price',
          selector: generateRelativeSelector(container, el),
          extractor: 'number',
          sampleValue: describeNumber(parsed),
          element: el,
        });
        break;
      }
    }
  }

  // 5. Rating / Reviews
  const ratingRegex = heuristics?.ratings || DEFAULT_RATING_REGEX;
  const ratingEl = container.querySelector(
    '[class*="rating" i], [class*="stars" i], [aria-label*="star" i], [aria-label*="rating" i], [data-rating]'
  );
  if (ratingEl && !visitedElements.has(ratingEl)) {
    const rawRating =
      ratingEl.getAttribute('aria-label') ||
      ratingEl.getAttribute('data-rating') ||
      ratingEl.textContent ||
      '';
    const match = rawRating.match(ratingRegex);
    const num = match ? parseNumberValue(match[1] || match[0]) : parseNumberValue(rawRating);
    if (num !== null) {
      visitedElements.add(ratingEl);
      candidates.push({
        name: 'Rating',
        type: 'rating',
        selector: generateRelativeSelector(container, ratingEl),
        extractor: 'number',
        sampleValue: String(num),
        element: ratingEl,
      });
    }
  }

  // 6. Dates
  const dateRegex = heuristics?.dates || DEFAULT_DATE_REGEX;
  const timeEl = container.querySelector('time, [class*="date" i], [class*="posted" i], [class*="time" i]');
  if (timeEl && !visitedElements.has(timeEl)) {
    const rawDate = timeEl.getAttribute('datetime') || normalizeText(timeEl.textContent);
    if (rawDate && (dateRegex.test(rawDate) || timeEl.tagName === 'TIME')) {
      visitedElements.add(timeEl);
      candidates.push({
        name: 'Date',
        type: 'date',
        selector: generateRelativeSelector(container, timeEl),
        extractor: timeEl.hasAttribute('datetime') ? 'attribute' : 'text',
        attributeName: timeEl.hasAttribute('datetime') ? 'datetime' : undefined,
        sampleValue: rawDate,
        element: timeEl,
      });
    }
  }

  // 7. Buttons / Actions
  const btnEl = container.querySelector('button, [role="button"], a[class*="btn" i], a[class*="button" i]');
  if (btnEl && !visitedElements.has(btnEl)) {
    const btnText = normalizeText(btnEl.textContent);
    if (btnText && (DEFAULT_BUTTON_TEXT_REGEX.test(btnText) || btnEl.tagName === 'BUTTON')) {
      visitedElements.add(btnEl);
      candidates.push({
        name: 'Action',
        type: 'button',
        selector: generateRelativeSelector(container, btnEl),
        extractor: 'text',
        sampleValue: btnText,
        element: btnEl,
      });
    }
  }

  // 8. Description / Summary
  const descEl = container.querySelector('p, [class*="desc" i], [class*="summary" i], [class*="snippet" i], [class*="excerpt" i]');
  if (descEl && !visitedElements.has(descEl)) {
    const text = normalizeText(descEl.textContent);
    if (text && text.length > 10) {
      visitedElements.add(descEl);
      candidates.push({
        name: 'Description',
        type: 'text',
        selector: generateRelativeSelector(container, descEl),
        extractor: 'text',
        sampleValue: text.slice(0, 100),
        element: descEl,
      });
    }
  }

  // 9. Badges / Categories
  const badgeEl = container.querySelector('[class*="badge" i], [class*="tag" i], [class*="category" i]');
  if (badgeEl && !visitedElements.has(badgeEl)) {
    const text = normalizeText(badgeEl.textContent);
    if (text && text.length < 30) {
      visitedElements.add(badgeEl);
      candidates.push({
        name: 'Category',
        type: 'text',
        selector: generateRelativeSelector(container, badgeEl),
        extractor: 'text',
        sampleValue: text,
        element: badgeEl,
      });
    }
  }

  // 10. Plain text, for items with no heading or description to recognize
  if (!candidates.some((candidate) => candidate.type === 'text' && candidate.name !== 'Category')) {
    candidates.push(...plainTextCandidates(container, visitedElements));
  }

  return candidates;
}

/**
 * Sites often shorten long titles on screen and keep the full one in a title attribute.
 * Fields are chosen from the first row, whose title may happen to fit, so an attribute
 * that repeats the visible text is used as well as a longer one.
 */
function findFullTitle(titleEl: Element, text: string): { element: Element; value: string } | null {
  const visiblePart = text.replace(TRUNCATED_TEXT_REGEX, '').trim().toLowerCase();
  const holders = [titleEl, ...Array.from(titleEl.querySelectorAll('[title]'))];
  for (const element of holders) {
    const value = normalizeText(element.getAttribute('title'));
    if (value && value.toLowerCase().startsWith(visiblePart)) {
      return { element, value };
    }
  }
  return null;
}

function ownText(element: Element): string {
  const text = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ');
  return normalizeText(text);
}

function plainTextFieldName(element: Element, used: Set<string>): string {
  const label = filterMeaningfulClasses(element.classList)[0]
    ?.replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
  let number = 1;
  let name = label ?? `Text ${number}`;
  while (used.has(name)) {
    number += 1;
    name = `${label ?? 'Text'} ${number}`;
  }
  used.add(name);
  return name;
}

function plainTextCandidates(container: Element, visited: Set<Element>): InternalFieldCandidate[] {
  const candidates: InternalFieldCandidate[] = [];
  const used = new Set<string>();
  const elements = Array.from(container.querySelectorAll('*'));

  for (const element of elements) {
    if (candidates.length >= MAX_PLAIN_TEXT_FIELDS) break;
    if (visited.has(element) || NOT_PLAIN_TEXT_TAGS.has(element.tagName)) continue;
    const text = ownText(element);
    // Short connecting words and labels such as "by" or "Tags:" are not values.
    if ((text.length < 3 && !/[0-9]/.test(text)) || text.endsWith(':')) continue;
    visited.add(element);
    candidates.push({
      name: plainTextFieldName(element, used),
      type: 'text',
      selector: generateRelativeSelector(container, element),
      extractor: 'text',
      sampleValue: text.slice(0, 100),
      element,
    });
  }
  return candidates;
}

/**
 * Discovers fields across an entire cluster of repeated container items.
 * Uses bounded sampling for large containers to avoid expensive DOM queries.
 */
export function discoverFieldsInCluster(
  cluster: Element[],
  heuristics?: FieldHeuristicConfig
): DiscoveredField[] {
  if (cluster.length === 0) return [];

  const repItem = cluster[0];
  const repCandidates = extractCandidatesFromElement(repItem, heuristics);

  // Bounded sampling: test field coverage on up to 8 elements for maximum responsiveness
  const testSample = cluster.length <= 16 ? cluster : sampleElements(cluster, 8);
  const discovered: DiscoveredField[] = [];

  for (let idx = 0; idx < repCandidates.length; idx++) {
    const cand = repCandidates[idx];
    let sampleOccurrences = 0;

    for (const item of testSample) {
      try {
        const found = cand.selector === '' ? item : item.querySelector(cand.selector);
        if (found) sampleOccurrences++;
      } catch {
        // Invalid selector fallback
      }
    }

    const coverage = Math.round((sampleOccurrences / testSample.length) * 100) / 100;
    const estimatedTotalOccurrences = Math.round(coverage * cluster.length);

    // Keep field if it occurs in at least 25% of items or at least 2 items
    if (estimatedTotalOccurrences >= 2 || cluster.length === 1) {
      discovered.push({
        id: `field_${cand.type}_${idx + 1}`,
        name: cand.name,
        selector: cand.selector,
        extractor: cand.extractor,
        attributeName: cand.attributeName,
        sampleValue: cand.sampleValue,
        type: cand.type,
        confidence: Math.round(coverage * 100) / 100,
        occurrences: estimatedTotalOccurrences,
        coverage,
        // Discovering a field never makes it required. Requiring a value is an
        // explicit filtering choice the user makes when configuring the field.
        required: false,
      });
    }
  }

  return discovered;
}

/**
 * Backward compatibility with existing detectFieldsInContainer
 */
export function detectFieldsInContainer(container: Element): DetectedFieldSuggestion[] {
  const candidates = extractCandidatesFromElement(container);
  return candidates.map((c) => ({
    name: c.name,
    selector: c.selector,
    extractor: c.extractor,
    attributeName: c.attributeName,
    sampleValue: c.sampleValue,
    type: c.type,
  }));
}

/**
 * Converts detected suggestions into initial FieldDefinition list
 */
export function suggestionsToFieldDefinitions(
  suggestions: DetectedFieldSuggestion[] | DiscoveredField[]
): FieldDefinition[] {
  return suggestions.map((s, index) => ({
    id: `field_${index + 1}_${Date.now()}`,
    name: s.name,
    selector: s.selector,
    extractor: s.extractor,
    attributeName: s.attributeName,
    required: false,
  }));
}
