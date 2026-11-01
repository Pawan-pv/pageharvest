import { ExtendedFieldExtractorType } from './types';
import { FieldExtractorType } from '@/types';

/**
 * Standard mapping of common HTML named entities to their unicode characters.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&amp;': '&',
  '&apos;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&euro;': '€',
  '&pound;': '£',
  '&yen;': '¥',
  '&cent;': '¢',
  '&deg;': '°',
  '&plusmn;': '±',
  '&times;': '×',
  '&divide;': '÷',
  '&bull;': '•',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
  '&lsquo;': "'",
  '&rsquo;': "'",
  '&ldquo;': '"',
  '&rdquo;': '"',
};

/**
 * Decodes HTML entities (named, decimal, and hexadecimal) into unicode characters.
 */
export function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';

  return text
    // 1. Replace named entities
    .replace(/&[a-zA-Z]+;/g, (match) => HTML_ENTITIES[match] || match)
    // 2. Replace hexadecimal entities &#xHHHH;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        const code = parseInt(hex, 16);
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    // 3. Replace decimal entities &#DDDD;
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        const code = parseInt(dec, 10);
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    });
}

/**
 * Normalizes text content: trims, collapses whitespace, converts \u00A0 to standard space,
 * decodes HTML entities, and strips zero-width spaces.
 */
export function normalizeText(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'string' ? val : String(val);

  return decodeHtmlEntities(str)
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes and extracts numeric values from string text (e.g. "$1,299.99", "€ 49,99", "4.8 out of 5").
 * Handles currency symbols, international thousand separators, decimal commas/dots,
 * ratings, negative signs, and discounts.
 */
export function normalizeNumber(val: unknown): number | null {
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  if (val === null || val === undefined) return null;

  const raw = String(val).trim();
  if (raw.length === 0) return null;

  const decoded = decodeHtmlEntities(raw);

  // Check for Free / Gratis
  if (/^(free|gratis|complimentary)/i.test(decoded)) {
    return 0;
  }

  // Check for rating pattern (e.g. "4.8 out of 5" or "4.8 / 5" or "Rating: 4.8")
  const ratingMatch = decoded.match(/(\d+(?:\.\d+)?)\s*(?:out of|\/)\s*\d+/i);
  if (ratingMatch) {
    const r = parseFloat(ratingMatch[1]);
    return isNaN(r) ? null : r;
  }

  // Remove currency words/symbols and whitespace around them
  let normalized = decoded
    .replace(/\b(?:USD|EUR|GBP|CAD|AUD|JPY|INR|CHF)\b/gi, '')
    .replace(/[$€£¥₹₩₽₺]/g, '')
    .trim();

  // Handle European decimal comma (e.g. "49,99" or "1.299,99" or "1 299,99") vs American ("1,299.99")
  if (/,\d{1,2}$/.test(normalized) && !/\.\d{1,2}$/.test(normalized)) {
    // Comma at end is decimal separator
    normalized = normalized.replace(/[\s.]/g, '').replace(/,/g, '.');
  } else {
    // Dot is decimal separator or no decimal; remove thousand commas & spaces
    normalized = normalized.replace(/[\s,]/g, '');
  }

  // Extract match of optional minus sign, digits, and optional decimal portion
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = parseFloat(match[0]);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Normalizes price values. By default, returns formatted price strings (e.g. "$129.00", "€ 49,99")
 * or numeric price depending on configuration.
 */
export function normalizePrice(
  val: unknown,
  options: { returnFormatted?: boolean } = { returnFormatted: true }
): string | number | null {
  if (val === null || val === undefined) return null;
  const raw = String(val).trim();
  if (raw.length === 0) return null;

  const decoded = decodeHtmlEntities(raw);

  // Handle Free
  if (/^(free|gratis|complimentary)/i.test(decoded)) {
    return options.returnFormatted ? '$0.00' : 0;
  }

  if (options.returnFormatted) {
    // Clean and collapse whitespace inside price string
    const cleaned = decoded.replace(/\s+/g, ' ').trim();
    // Validate that it has at least some digits
    if (/\d/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }

  return normalizeNumber(decoded);
}

/**
 * Resolves relative URLs into valid absolute URLs using a base URL.
 * Safely filters out javascript:, vbscript:, and malformed URIs.
 */
export function normalizeUrl(
  relativeOrAbsolute: unknown,
  baseUrl: string = 'http://localhost'
): string | null {
  if (relativeOrAbsolute === null || relativeOrAbsolute === undefined) return null;
  const trimmed = String(relativeOrAbsolute).trim();
  if (trimmed.length === 0) return null;

  // Filter unsafe pseudo-protocols
  if (/^(javascript|vbscript|file):/i.test(trimmed)) {
    return null;
  }

  // Allow data: URIs (e.g. data:image/png;base64,...)
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }

  try {
    // Handle protocol-relative URLs (e.g. //cdn.example.com/pic.png)
    if (trimmed.startsWith('//')) {
      const baseProto = baseUrl.startsWith('http:') ? 'http:' : 'https:';
      return `${baseProto}${trimmed}`;
    }

    const resolved = new URL(trimmed, baseUrl);
    // Ensure valid web protocol
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:' && resolved.protocol !== 'data:') {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Resolves image URLs from image elements, background styles, or srcset candidates.
 */
export function normalizeImageUrl(
  valOrElement: unknown,
  baseUrl: string = 'http://localhost'
): string | null {
  if (!valOrElement) return null;

  let candidateUrl: string | null = null;

  // Check if valOrElement is a DOM Element
  if (typeof (valOrElement as Element).getAttribute === 'function') {
    const el = valOrElement as Element;

    // 1. Direct src
    candidateUrl = el.getAttribute('src');

    // 2. Data attributes commonly used for lazy loading
    if (!candidateUrl) {
      candidateUrl =
        el.getAttribute('data-src') ||
        el.getAttribute('data-lazy-src') ||
        el.getAttribute('data-original') ||
        el.getAttribute('data-url');
    }

    // 3. srcset attribute
    if (!candidateUrl) {
      const srcset = el.getAttribute('srcset');
      if (srcset) {
        // e.g. "/img/small.jpg 300w, /img/large.jpg 1000w"
        const firstCandidate = srcset.split(',')[0].trim().split(/\s+/)[0];
        if (firstCandidate) candidateUrl = firstCandidate;
      }
    }

    // 4. Background-image CSS property
    if (!candidateUrl) {
      const style = el.getAttribute('style');
      if (style) {
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")]+)['"]?\)/i);
        if (bgMatch && bgMatch[1]) {
          candidateUrl = bgMatch[1];
        }
      }
    }
  } else if (typeof valOrElement === 'string') {
    candidateUrl = valOrElement;
  }

  return normalizeUrl(candidateUrl, baseUrl);
}

/**
 * Normalizes dates into standard ISO-8601 YYYY-MM-DD format.
 * Supports ISO strings, YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, Month DD YYYY, and relative dates.
 */
export function normalizeDate(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const raw = String(val).trim();
  if (raw.length === 0) return null;

  // 1. Relative dates: "today", "yesterday", "X days ago"
  const lower = raw.toLowerCase();
  const now = new Date();
  if (lower === 'today') {
    return now.toISOString().split('T')[0];
  }
  if (lower === 'yesterday') {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toISOString().split('T')[0];
  }
  const daysAgoMatch = lower.match(/^(\d+)\s+days?\s+ago/);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return past.toISOString().split('T')[0];
  }

  // 2. Standard ISO date: YYYY-MM-DD
  const isoMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = isoMatch[2].padStart(2, '0');
    const day = isoMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 3. Fallback to Date parsing
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Normalizes boolean values from strings or DOM element state (checked, disabled, classNames).
 */
export function normalizeBoolean(val: unknown, element?: Element | null): boolean | null {
  if (element) {
    const inputEl = element as HTMLInputElement;
    if (typeof inputEl.checked === 'boolean') {
      return inputEl.checked;
    }
    if (element.hasAttribute('disabled')) {
      return false;
    }
    const ariaChecked = element.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;

    // Check classes for semantic state
    const classList = Array.from(element.classList);
    if (classList.some((c) => /^(in-stock|available|active|enabled|instock)$/i.test(c))) {
      return true;
    }
    if (classList.some((c) => /^(out-of-stock|unavailable|inactive|disabled|outofstock)$/i.test(c))) {
      return false;
    }
  }

  if (typeof val === 'boolean') return val;
  if (val === null || val === undefined) return null;

  const str = String(val).trim().toLowerCase();
  if (['true', 'yes', '1', 'in stock', 'available', 'active', 'on', 'instock'].includes(str)) {
    return true;
  }
  if (['false', 'no', '0', 'out of stock', 'unavailable', 'inactive', 'off', 'outofstock'].includes(str)) {
    return false;
  }

  return null;
}

/**
 * Extracts a regex captured group from text safely.
 */
export function normalizeRegex(
  val: unknown,
  pattern: string,
  groupIndex: number = 0
): string | null {
  if (val === null || val === undefined || !pattern) return null;
  const str = String(val);

  try {
    const rx = new RegExp(pattern);
    const match = str.match(rx);
    if (!match) return null;
    return match[groupIndex] !== undefined ? match[groupIndex] : null;
  } catch {
    return null;
  }
}

/**
 * Options passed to the field normalizer.
 */
export interface NormalizerOptions {
  baseUrl?: string;
  regexPattern?: string;
  regexGroup?: number;
  defaultValue?: string;
  element?: Element | null;
  attributeName?: string;
}

/**
 * Master dispatcher for field normalization across all supported data types.
 */
export function normalizeFieldValue(
  rawValue: unknown,
  extractor: FieldExtractorType | ExtendedFieldExtractorType,
  options: NormalizerOptions = {}
): string | number | boolean | null {
  let result: string | number | boolean | null;
  const ext = extractor.toLowerCase();

  switch (ext) {
    case 'text':
      result = normalizeText(rawValue);
      break;

    case 'number':
    case 'numeric':
      result = normalizeNumber(rawValue);
      break;

    case 'price':
    case 'prices':
      result = normalizePrice(rawValue, { returnFormatted: true });
      break;

    case 'date':
    case 'dates':
      result = normalizeDate(rawValue);
      break;

    case 'boolean':
      result = normalizeBoolean(rawValue, options.element);
      break;

    case 'href':
    case 'link':
    case 'links':
      result = normalizeUrl(
        typeof rawValue === 'string' ? rawValue : null,
        options.baseUrl || (typeof window !== 'undefined' ? window.location.href : 'http://localhost')
      );
      break;

    case 'src':
    case 'image':
    case 'images':
      result = normalizeImageUrl(
        options.element || rawValue,
        options.baseUrl || (typeof window !== 'undefined' ? window.location.href : 'http://localhost')
      );
      break;

    case 'regex':
      result = normalizeRegex(
        typeof rawValue === 'string' ? rawValue : String(rawValue || ''),
        options.regexPattern || '',
        options.regexGroup ?? 0
      );
      break;

    case 'attribute':
    case 'attributes':
    case 'html':
    default:
      result = typeof rawValue === 'string' ? rawValue.trim() : (rawValue != null ? String(rawValue) : null);
      break;
  }

  // Handle empty string or null with fallback defaultValue
  if ((result === null || result === '') && options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  return result;
}
