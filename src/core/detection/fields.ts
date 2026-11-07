import {
  DetectedFieldSuggestion,
  DiscoveredField,
  DiscoveredFieldType,
  FieldExtractorType,
  FieldDefinition,
  FieldHeuristicConfig,
} from '@/types';
import { escapeCss, filterMeaningfulClasses, generateRelativeSelector } from '@/utils/selector';
import { normalizeText, resolveAbsoluteUrl, parseNumberValue } from '@/utils/dom';
import { NumberParseResult, parseNumberDetailed } from '@/utils/number-parser';
import { normalizeImageUrl } from '@/core/extraction/normalizer';

const TRUNCATED_TEXT_REGEX = /(?:\.{3}|…)$/;
const MAX_PLAIN_TEXT_FIELDS = 4;
const NOT_PLAIN_TEXT_TAGS = new Set(['A', 'BUTTON', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

// Currency regex supporting $, €, £, ¥, ₹, C$, A$, USD, EUR, GBP, INR, etc.
const DEFAULT_PRICE_REGEX = /(?:[$€£¥₹]|C\$|A\$)\s*[-+]?\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:[$€£¥₹]|(?:USD|EUR|GBP|INR)\b)/i;

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
  extractor: FieldExtractorType;
  attributeName?: string;
  regexPattern?: string;
  regexGroup?: number;
  sampleValue: string;
  element: Element;
  /** Text found only because the item had no recognized heading or description. */
  plain?: boolean;
  /** A value recognized only by its class name. */
  labelled?: boolean;
  /** A link other than the record's main one. */
  otherLink?: boolean;
  linkText?: string;
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
  // A heading that holds only a number is a price or a count, not the title.
  const titleEl = Array.from(container.querySelectorAll(titleSelectors.join(', '))).find((element) => {
    const heading = normalizeText(element.textContent);
    return heading.length > 0 && /\p{L}/u.test(heading.replace(/\b[A-Z]{3}\b/g, ''));
  });
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
    'img[src]', 'img[data-src]', 'img[data-lazy-src]', 'img[data-original]', 'img[data-lazy]',
    'img[srcset]', 'img[data-srcset]', 'picture > source[srcset]', '[style*="background-image"]',
  ];
  const imgEl = container.querySelector(imgSelectors.join(', '));
  if (imgEl && !visitedElements.has(imgEl)) {
    const src = normalizeImageUrl(imgEl, imgEl.baseURI || undefined);
    if (src) {
      visitedElements.add(imgEl);
      candidates.push({
        name: 'Image',
        type: 'image',
        selector: generateRelativeSelector(container, imgEl),
        extractor: 'src',
        sampleValue: src,
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
      // A wrapper around a sale price and an old price: the price is one of its children.
      if (parsed.status === 'ambiguous' && el.children.length > 0) continue;
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
        name: descriptionName(descEl),
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

  // 10. Other labelled values and links the record holds
  const hasHeadingOrDescription = candidates.some(
    (candidate) => candidate.type === 'text' && candidate.name !== 'Category'
  );
  candidates.push(...labelledTextCandidates(container, visitedElements, candidates));
  candidates.push(...otherLinkCandidates(container, visitedElements));

  // 11. Plain text, for items with no heading or description to recognize
  if (!hasHeadingOrDescription) {
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

/** Class names that say how something looks, not what it is. */
const LAYOUT_CLASS =
  /^(?:col|row|mb|mt|ml|mr|mx|my|me|ms|pb|pt|pl|pr|px|py|ps|pe|p|m|d|text|font|fw|fs|bg|flex|grid|gap|w|h|border|rounded|shadow|is|has|js|align|justify|float|clearfix|container|wrapper|inner|outer|hidden|visible|sr|small|large|big|bold|italic|center|left|right|lead|muted)(?:$|[-_])/i;
const LOOKS_GENERATED = /\d.*[a-z]|[a-z].*\d/i;
const DESCRIPTION_CLASS = /desc|summary|snippet|excerpt|^text$|content|body/i;
const MAX_LABELLED_FIELDS = 6;
const MAX_OTHER_LINKS = 3;

function titleCaseWords(text: string): string {
  return text.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

/** A column name from what an element's classes say it is, if they say anything. */
function labelFromClasses(element: Element): string | null {
  const useful = filterMeaningfulClasses(element.classList).filter(
    (name) => !LAYOUT_CLASS.test(name) && !LOOKS_GENERATED.test(name) && name.length >= 3
  );
  const last = useful[useful.length - 1];
  return last ? titleCaseWords(last) : null;
}

function descriptionName(element: Element): string {
  const label = labelFromClasses(element);
  return !label || DESCRIPTION_CLASS.test(label) ? 'Description' : label;
}

function isInsideAny(element: Element, others: Set<Element>): boolean {
  let current = element.parentElement;
  while (current) {
    if (others.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * A record usually holds more than a title and a price. A value whose class says what it is
 * becomes a column named after that class, such as the capital of a country.
 */
function labelledTextCandidates(
  container: Element,
  visited: Set<Element>,
  existing: InternalFieldCandidate[]
): InternalFieldCandidate[] {
  const names = new Set(existing.map((candidate) => candidate.name));
  const candidates: InternalFieldCandidate[] = [];

  for (const element of Array.from(container.querySelectorAll('[class]'))) {
    if (candidates.length >= MAX_LABELLED_FIELDS) break;
    if (visited.has(element) || isInsideAny(element, visited) || NOT_PLAIN_TEXT_TAGS.has(element.tagName)) continue;
    const text = ownText(element);
    if ((text.length < 3 && !/[0-9]/.test(text)) || text.endsWith(':')) continue;
    const name = labelFromClasses(element);
    if (!name || names.has(name)) continue;

    names.add(name);
    visited.add(element);
    candidates.push({
      name,
      type: 'text',
      selector: generateRelativeSelector(container, element),
      extractor: 'text',
      sampleValue: text.slice(0, 100),
      element,
      labelled: true,
    });
  }
  return candidates;
}

/**
 * A card's other links, such as Apply next to Learn more. A second link to the same place
 * is not another value, and a run of links that look alike is a list of tags, not columns.
 */
function otherLinkCandidates(container: Element, visited: Set<Element>): InternalFieldCandidate[] {
  const candidates: InternalFieldCandidate[] = [];
  const links = Array.from(container.querySelectorAll('a[href]'));
  const known = new Set(links.filter((link) => visited.has(link)).map((link) => link.getAttribute('href')));
  const siblingsAlike = (link: Element) =>
    Array.from(link.parentElement?.children ?? []).filter(
      (other) => other.tagName === 'A' && other.getAttribute('class') === link.getAttribute('class')
    ).length;

  for (const link of links) {
    if (candidates.length >= MAX_OTHER_LINKS) break;
    const href = link.getAttribute('href') ?? '';
    if (visited.has(link) || known.has(href) || /^(?:#|javascript:)/i.test(href)) continue;
    if (siblingsAlike(link) > 2) continue;
    const text = normalizeText(link.textContent);
    if (!text || text.length > 24 || text.split(' ').length > 3) continue;

    known.add(href);
    visited.add(link);
    candidates.push({
      name: `${titleCaseWords(text)} link`,
      type: 'link',
      selector: generateRelativeSelector(container, link),
      extractor: 'href',
      sampleValue: resolveAbsoluteUrl(href),
      element: link,
      otherLink: true,
      linkText: text,
    });
  }
  return candidates;
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
      plain: true,
    });
  }
  return candidates;
}

const DEFAULT_FIELD_SAMPLE = 12;
/** A short label on few records is decoration, not a column most people want. */
const LABEL_MIN_COVERAGE = 0.5;
/** A column on fewer records than this is offered, but not selected by default. */
const MIN_SUGGESTED_COVERAGE = 0.2;
/** A link column must recur. Links that differ on each record are content, such as tags. */
const MIN_OTHER_LINK_COVERAGE = 0.5;
/** A value known only by its class must recur to be offered at all. */
const MIN_LABELLED_COVERAGE = 0.2;

/** Evenly spread through the list, always including the first and the last. */
function representativeSample(cluster: Element[], size: number): Element[] {
  if (cluster.length <= size) return cluster;
  const step = (cluster.length - 1) / (size - 1);
  return Array.from({ length: size }, (_, index) => cluster[Math.round(index * step)]);
}

/** Ways to reach an element from its item, from most to least stable. */
function selectorOptions(item: Element, element: Element, generated: string): string[] {
  const options: string[] = [];
  const tag = element.tagName.toLowerCase();
  const classes = filterMeaningfulClasses(element.classList);
  if (classes.length > 0) {
    options.push(`${tag}.${classes.map(escapeCss).join('.')}`, `${tag}.${escapeCss(classes[0])}`);
  } else {
    options.push(`${tag}:not([class])`);
  }
  const parent = element.parentElement;
  if (parent && parent !== item) {
    const parentClasses = filterMeaningfulClasses(parent.classList);
    if (parentClasses.length > 0) {
      options.push(`${parent.tagName.toLowerCase()}.${escapeCss(parentClasses[0])} > ${tag}`);
    }
  }
  // An element with a class is identified by it. Dropping the class would let a badge on
  // one record claim whatever the same tag holds on all the others.
  if (classes.length === 0) options.push(tag, `${tag}:last-of-type`);
  options.push(generated);
  return options.filter((option, index) => {
    if (options.indexOf(option) !== index) return false;
    if (option === '') return element === item;
    try {
      return item.querySelector(option) === element;
    } catch {
      return false;
    }
  });
}

/** Whether an element holds the kind of value this field is for. */
function holdsValue(element: Element, candidate: InternalFieldCandidate): boolean {
  switch (candidate.type) {
    case 'link':
      // A link named after what it says is only that link, not any link with the same class.
      if (candidate.otherLink && normalizeText(element.textContent) !== candidate.linkText) return false;
      return Boolean(element.getAttribute('href'));
    case 'image':
      return normalizeImageUrl(element, element.baseURI || undefined) !== null;
    case 'price':
      return DEFAULT_PRICE_REGEX.test(element.textContent ?? '');
    default:
      if (candidate.extractor === 'attribute' && candidate.attributeName) {
        return Boolean(element.getAttribute(candidate.attributeName)?.trim());
      }
      return normalizeText(element.textContent).length > 0;
  }
}

interface FieldEvidence {
  candidate: InternalFieldCandidate;
  options: string[];
  elementByItem: Map<Element, Element>;
}

function scoreOption(
  option: string,
  evidence: FieldEvidence,
  sample: Element[],
  claimedElements: Map<Element, Set<FieldEvidence>>
) {
  let hits = 0;
  let conflicts = 0;
  for (const item of sample) {
    let found: Element | null;
    try {
      found = option === '' ? item : item.querySelector(option);
    } catch {
      found = null;
    }
    if (!found) continue;
    const expected = evidence.elementByItem.get(item);
    const owners = claimedElements.get(found);
    const ownedByAnother = owners !== undefined && !owners.has(evidence);
    if (!ownedByAnother && holdsValue(found, evidence.candidate) && (!expected || expected === found)) {
      hits += 1;
    } else {
      conflicts += 1;
    }
  }
  return { hits, conflicts };
}

function isPositional(selector: string): boolean {
  return /nth-child|nth-of-type/.test(selector);
}

function isSuggested(candidate: InternalFieldCandidate, coverage: number): boolean {
  if (candidate.name === 'Category') return coverage >= LABEL_MIN_COVERAGE;
  return coverage >= MIN_SUGGESTED_COVERAGE;
}

/**
 * Discovers fields from a sample of the records, not just the first. A field found on any
 * sampled record is offered. Its selector is the one that best finds the right kind of
 * value across the whole sample, so a position that means different data in different
 * records loses. Coverage and confidence report only what was actually observed.
 */
export function discoverFieldsInCluster(
  cluster: Element[],
  heuristics?: FieldHeuristicConfig,
  options: { sampleSize?: number } = {}
): DiscoveredField[] {
  if (cluster.length === 0) return [];

  const sample = representativeSample(cluster, options.sampleSize ?? DEFAULT_FIELD_SAMPLE);
  const merged = new Map<string, FieldEvidence>();

  for (const item of sample) {
    for (const candidate of extractCandidatesFromElement(item, heuristics)) {
      const key = `${candidate.type}|${candidate.name}`;
      const evidence: FieldEvidence = merged.get(key) ?? { candidate, options: [], elementByItem: new Map() };
      evidence.elementByItem.set(item, candidate.element);
      for (const option of selectorOptions(item, candidate.element, candidate.selector)) {
        if (!evidence.options.includes(option)) evidence.options.push(option);
      }
      merged.set(key, evidence);
    }
  }

  // On each record, every element belongs to the fields that recognized it there. One link
  // can rightly supply two, with its address as the link and its title as the name.
  const claimedElements = new Map<Element, Set<FieldEvidence>>();
  for (const evidence of merged.values()) {
    for (const element of evidence.elementByItem.values()) {
      const owners = claimedElements.get(element) ?? new Set<FieldEvidence>();
      owners.add(evidence);
      claimedElements.set(element, owners);
    }
  }

  const discovered: DiscoveredField[] = [];
  for (const evidence of merged.values()) {
    let best: { selector: string; hits: number; conflicts: number } | null = null;
    for (const option of evidence.options) {
      const { hits, conflicts } = scoreOption(option, evidence, sample, claimedElements);
      const net = hits - conflicts;
      const bestNet = best ? best.hits - best.conflicts : -Infinity;
      const isBetter =
        net > bestNet ||
        (net === bestNet && best !== null && isPositional(best.selector) && !isPositional(option));
      if (isBetter) best = { selector: option, hits, conflicts };
    }
    if (!best || best.hits === 0) continue;

    const coverage = Math.round((best.hits / sample.length) * 100) / 100;
    if (evidence.candidate.otherLink && coverage < MIN_OTHER_LINK_COVERAGE) continue;
    if (evidence.candidate.labelled && coverage < MIN_LABELLED_COVERAGE) continue;
    const agreement = best.hits / (best.hits + best.conflicts);
    const { candidate } = evidence;
    discovered.push({
      id: `field_${candidate.type}_${discovered.length + 1}`,
      name: candidate.name,
      selector: best.selector,
      extractor: candidate.extractor,
      attributeName: candidate.attributeName,
      sampleValue: candidate.sampleValue,
      type: candidate.type,
      confidence: Math.round(coverage * agreement * 100) / 100,
      occurrences: Math.round((best.hits / sample.length) * cluster.length),
      coverage,
      sampleSize: sample.length,
      suggested: isSuggested(candidate, coverage),
      // Discovering a field never makes it required. Requiring a value is an
      // explicit filtering choice the user makes when configuring the field.
      required: false,
    });
  }

  // Text picked up from a record with no heading is noise once a real heading column exists.
  const candidateOf = (field: DiscoveredField) => merged.get(`${field.type}|${field.name}`)?.candidate;
  const hasHeadingColumn = discovered.some((field) => {
    const candidate = candidateOf(field);
    return field.type === 'text' && field.name !== 'Category' && !candidate?.plain && !candidate?.labelled && field.coverage >= 0.5;
  });
  return hasHeadingColumn ? discovered.filter((field) => !candidateOf(field)?.plain) : discovered;
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
    // Anchors ride along so the saved recipe can self-heal later.
    ...('anchor' in s ? { anchor: s.anchor } : {}),
    ...('coverage' in s
      ? {
          discovery: {
            coverage: s.coverage,
            confidence: s.confidence,
            sampleSize: s.sampleSize,
            occurrences: s.occurrences,
            suggested: s.suggested,
            sampleValue: s.sampleValue,
          },
        }
      : {}),
  }));
}
