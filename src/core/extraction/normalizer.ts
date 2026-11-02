import { ExtendedFieldExtractorType } from './types';
import { FieldExtractorType } from '@/types';
import { parseNumberDetailed } from '@/utils/number-parser';

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
 * Reads one number, or null if the text has none or cannot be read with certainty.
 * See utils/number-parser for what counts as certain.
 */
export function normalizeNumber(val: unknown): number | null {
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  if (val === null || val === undefined) return null;
  return parseNumberDetailed(decodeHtmlEntities(String(val))).value;
}

/** The language of the page an element is on, which can settle an ambiguous separator. */
export function pageLocaleOf(element: Element | null | undefined): string | undefined {
  const lang = element?.ownerDocument?.documentElement?.getAttribute('lang')?.trim();
  return lang || undefined;
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

const LAZY_IMAGE_ATTRIBUTES = [
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-lazy',
  'data-url',
  'data-image',
  'data-img',
  'data-full-src',
  'data-hi-res-src',
];
const SRCSET_ATTRIBUTES = ['srcset', 'data-srcset', 'data-lazy-srcset'];
const PLACEHOLDER_FILE =
  /(?:^|[/_-])(?:blank|spacer|placeholder|transparent|pixel|empty|loading|loader|lazy[-_]?load(?:er|ing)?|1x1)(?:[-_.][^/]*)?\.(?:gif|png|svg|jpe?g|webp)(?:[?#].*)?$/i;
/** Below this an embedded image is a loading pixel or icon. Above it, it is the picture. */
const REAL_DATA_URI_LENGTH = 2000;

function isDataUri(source: string): boolean {
  return /^data:/i.test(source);
}

function isPlaceholderSource(source: string): boolean {
  if (isDataUri(source)) return source.length < REAL_DATA_URI_LENGTH || /^data:image\/svg/i.test(source);
  return PLACEHOLDER_FILE.test(source);
}

/** The largest image a srcset offers. URLs can contain commas, so it cannot just be split. */
function largestSrcsetCandidate(srcset: string | null | undefined): string | null {
  if (!srcset) return null;
  let best: { url: string; size: number } | null = null;
  for (const match of srcset.matchAll(/(\S*[^\s,])(?:\s+(\d+(?:\.\d+)?)[wxh])?\s*(?:,|$)/g)) {
    const size = match[2] ? Number(match[2]) : 1;
    if (!best || size > best.size) best = { url: match[1], size };
  }
  return best?.url ?? null;
}

function realSourceOf(element: Element): { source: string | null; embedded: string | null } {
  let embedded: string | null = null;
  const consider = (value: string | null | undefined): string | null => {
    const source = value?.trim();
    if (!source) return null;
    if (!isPlaceholderSource(source)) {
      if (isDataUri(source)) {
        embedded = embedded ?? source;
        return null;
      }
      return source;
    }
    return null;
  };

  const found = (() => {
    const current = consider((element as HTMLImageElement).currentSrc);
    if (current) return current;
    const src = consider(element.getAttribute('src'));
    if (src) return src;
    for (const attribute of LAZY_IMAGE_ATTRIBUTES) {
      const lazy = consider(element.getAttribute(attribute));
      if (lazy) return lazy;
    }
    for (const attribute of SRCSET_ATTRIBUTES) {
      const fromSet = consider(largestSrcsetCandidate(element.getAttribute(attribute)));
      if (fromSet) return fromSet;
    }
    const picture = element.parentElement?.tagName === 'PICTURE' ? element.parentElement : null;
    for (const source of Array.from(picture?.querySelectorAll('source') ?? [])) {
      for (const attribute of SRCSET_ATTRIBUTES) {
        const fromSet = consider(largestSrcsetCandidate(source.getAttribute(attribute)));
        if (fromSet) return fromSet;
      }
    }
    const background = element.getAttribute('style')?.match(/background(?:-image)?:[^;]*url\(['"]?([^'")]+)['"]?\)/i);
    return consider(background?.[1]);
  })();

  return { source: found, embedded };
}

/**
 * The real image of an element, in order: what the browser loaded, the src, the attributes
 * lazy-loading libraries use, the largest srcset candidate, then a background image. A
 * loading placeholder is never returned, so a row with no real image has no value.
 */
export function normalizeImageUrl(
  valOrElement: unknown,
  baseUrl: string = 'http://localhost'
): string | null {
  if (!valOrElement) return null;

  if (typeof (valOrElement as Element).getAttribute !== 'function') {
    return typeof valOrElement === 'string' ? normalizeUrl(valOrElement, baseUrl) : null;
  }

  const element = valOrElement as Element;
  const own = realSourceOf(element);
  if (own.source) return normalizeUrl(own.source, baseUrl);

  // A link or picture selected as the field holds the image inside it.
  const inner = element.tagName === 'IMG' ? null : element.querySelector('img');
  const nested = inner ? realSourceOf(inner) : null;
  if (nested?.source) return normalizeUrl(nested.source, baseUrl);

  const embedded = own.embedded ?? nested?.embedded ?? null;
  return embedded ? normalizeUrl(embedded, baseUrl) : null;
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
    case 'numeric': {
      if (typeof rawValue === 'number') {
        result = isNaN(rawValue) ? null : rawValue;
        break;
      }
      const parsed = parseNumberDetailed(decodeHtmlEntities(String(rawValue ?? '')), {
        locale: pageLocaleOf(options.element),
      });
      // A range or an uncertain value stays as its text. It is never replaced by a guess.
      result = parsed.status === 'ok' ? parsed.value : parsed.status === 'invalid' ? null : normalizeText(parsed.raw);
      break;
    }

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
